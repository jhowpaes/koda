import fs from 'fs';
import path from 'path';
import os from 'os';

const KODA_DIR = path.join(os.homedir(), '.koda');
const TOKEN_FILE = path.join(KODA_DIR, 'copilot-auth.json');

const GITHUB_DEVICE_URL = 'https://github.com/login/device/code';
const GITHUB_TOKEN_URL  = 'https://github.com/login/oauth/access_token';
const COPILOT_TOKEN_URL = 'https://api.github.com/copilot_internal/v2/token';
const GITHUB_USER_URL   = 'https://api.github.com/user';

export const COPILOT_BASE_URL = 'https://api.githubcopilot.com';
export const COPILOT_MODELS   = 'gpt-4o,gpt-4o-mini,o3-mini,claude-3.5-sonnet,claude-3.7-sonnet,gemini-2.0-flash';

// Client ID de um GitHub OAuth App registrado para device flow com scope copilot.
// Usuário pode sobrescrever com seu próprio app nas configurações.
export const DEFAULT_CLIENT_ID = 'Iv1.b507a08c87ecfe98';

interface StoredAuth {
  githubToken: string;
  copilotToken?: string;
  copilotTokenExpiresAt?: number;
  username?: string;
  avatarUrl?: string;
}

export interface DeviceFlowStart {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export interface AuthStatus {
  connected: boolean;
  username?: string;
  avatarUrl?: string;
}

export async function startDeviceFlow(clientId: string = DEFAULT_CLIENT_ID): Promise<DeviceFlowStart> {
  const res = await fetch(GITHUB_DEVICE_URL, {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, scope: 'copilot' }),
  });
  const data = await res.json() as any;
  if (data.error) throw new Error(data.error_description ?? data.error);
  return {
    deviceCode:      data.device_code,
    userCode:        data.user_code,
    verificationUri: data.verification_uri,
    expiresIn:       data.expires_in,
    interval:        data.interval ?? 5,
  };
}

// Returns 'pending' | 'expired' | github_access_token string
export async function pollForGithubToken(
  clientId: string = DEFAULT_CLIENT_ID,
  deviceCode: string,
): Promise<'pending' | 'expired' | string> {
  const res = await fetch(GITHUB_TOKEN_URL, {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id:   clientId,
      device_code: deviceCode,
      grant_type:  'urn:ietf:params:oauth:grant-type:device_code',
    }),
  });
  const data = await res.json() as any;
  if (data.error === 'authorization_pending' || data.error === 'slow_down') return 'pending';
  if (data.error === 'expired_token') return 'expired';
  if (data.access_token) return data.access_token as string;
  return 'pending';
}

async function fetchGithubUser(githubToken: string): Promise<{ username: string; avatarUrl: string }> {
  const res = await fetch(GITHUB_USER_URL, {
    headers: {
      'Authorization': `token ${githubToken}`,
      'Accept': 'application/vnd.github.v3+json',
    },
  });
  const data = await res.json() as any;
  return { username: data.login ?? 'unknown', avatarUrl: data.avatar_url ?? '' };
}

async function fetchCopilotApiToken(githubToken: string): Promise<{ token: string; expiresAt: number }> {
  const res = await fetch(COPILOT_TOKEN_URL, {
    headers: {
      'Authorization':       `token ${githubToken}`,
      'Accept':              'application/json',
      'Editor-Version':      'vscode/1.85.0',
      'Editor-Plugin-Version': 'copilot/1.138.0',
      'User-Agent':          'KODA/1.0.0',
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GitHub Copilot token error ${res.status}: ${body}`);
  }
  const data = await res.json() as any;
  // expires_at is Unix seconds
  return { token: data.token, expiresAt: (data.expires_at ?? 0) * 1000 };
}

function loadAuth(): StoredAuth | null {
  try {
    return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

function saveAuth(auth: StoredAuth): void {
  fs.mkdirSync(KODA_DIR, { recursive: true });
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(auth, null, 2), 'utf-8');
}

export function clearAuth(): void {
  try { fs.unlinkSync(TOKEN_FILE); } catch {}
}

export function getAuthStatus(): AuthStatus {
  const auth = loadAuth();
  if (!auth?.githubToken) return { connected: false };
  return { connected: true, username: auth.username, avatarUrl: auth.avatarUrl };
}

// Call after pollForGithubToken returns a real token string.
export async function completeAuth(githubToken: string): Promise<AuthStatus> {
  const user = await fetchGithubUser(githubToken);
  const { token, expiresAt } = await fetchCopilotApiToken(githubToken);
  saveAuth({
    githubToken,
    copilotToken: token,
    copilotTokenExpiresAt: expiresAt,
    username: user.username,
    avatarUrl: user.avatarUrl,
  });
  return { connected: true, username: user.username, avatarUrl: user.avatarUrl };
}

// Returns a valid Copilot API token, refreshing if necessary.
export async function getValidCopilotToken(): Promise<string | null> {
  const auth = loadAuth();
  if (!auth?.githubToken) return null;

  const buffer = 60_000; // refresh 1 minute before expiry
  if (auth.copilotToken && auth.copilotTokenExpiresAt && Date.now() < auth.copilotTokenExpiresAt - buffer) {
    return auth.copilotToken;
  }

  try {
    const { token, expiresAt } = await fetchCopilotApiToken(auth.githubToken);
    saveAuth({ ...auth, copilotToken: token, copilotTokenExpiresAt: expiresAt });
    return token;
  } catch {
    return null;
  }
}
