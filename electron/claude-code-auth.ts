import fs from 'fs';
import os from 'os';
import path from 'path';

const CLAUDE_JSON = path.join(os.homedir(), '.claude.json');

// Anthropic OAuth token refresh endpoint (used by Claude Code / claude.ai)
const REFRESH_URL = 'https://claude.ai/api/auth/oauth/token';

export interface ClaudeCodeAccount {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number; // Unix ms
  emailAddress?: string;
  displayName?: string;
  accountUuid?: string;
  organizationName?: string;
  billingType?: string;
}

export interface ClaudeCodeStatus {
  connected: boolean;
  emailAddress?: string;
  displayName?: string;
  organizationName?: string;
  billingType?: string;
}

function readAccount(): ClaudeCodeAccount | null {
  try {
    const raw = fs.readFileSync(CLAUDE_JSON, 'utf-8');
    const data = JSON.parse(raw);
    const oa = data?.oauthAccount;
    if (!oa?.accessToken) return null;
    return oa as ClaudeCodeAccount;
  } catch {
    return null;
  }
}

export function getStatus(): ClaudeCodeStatus {
  const acc = readAccount();
  if (!acc) return { connected: false };
  return {
    connected: true,
    emailAddress:     acc.emailAddress,
    displayName:      acc.displayName,
    organizationName: acc.organizationName,
    billingType:      acc.billingType,
  };
}

async function refreshAccessToken(refreshToken: string): Promise<string | null> {
  try {
    const res = await fetch(REFRESH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: refreshToken }),
    });
    if (!res.ok) return null;
    const data = await res.json() as any;
    if (!data.access_token) return null;

    // Persist the new token back into ~/.claude.json
    const raw = fs.readFileSync(CLAUDE_JSON, 'utf-8');
    const json = JSON.parse(raw);
    json.oauthAccount.accessToken  = data.access_token;
    if (data.refresh_token) json.oauthAccount.refreshToken = data.refresh_token;
    if (data.expires_in)    json.oauthAccount.expiresAt = Date.now() + data.expires_in * 1000;
    fs.writeFileSync(CLAUDE_JSON, JSON.stringify(json), 'utf-8');

    return data.access_token as string;
  } catch {
    return null;
  }
}

// Returns a valid OAuth access token, refreshing if needed.
export async function getValidToken(): Promise<string | null> {
  const acc = readAccount();
  if (!acc) return null;

  const buffer = 60_000;
  const isExpired = acc.expiresAt && Date.now() > acc.expiresAt - buffer;

  if (!isExpired) return acc.accessToken;

  // Try to refresh
  if (acc.refreshToken) {
    const fresh = await refreshAccessToken(acc.refreshToken);
    if (fresh) return fresh;
  }

  // Return existing token and let the caller handle a 401
  return acc.accessToken;
}
