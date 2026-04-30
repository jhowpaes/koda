import fs from 'fs';
import os from 'os';
import path from 'path';
import https from 'https';
import { execSync } from 'child_process';

const CLAUDE_JSON       = path.join(os.homedir(), '.claude.json');
const KEYCHAIN_SERVICE  = 'Claude Code-credentials';
const KEYCHAIN_ACCOUNT  = os.userInfo().username;
const REFRESH_URL       = 'https://platform.claude.com/v1/oauth/token';

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

// Read OAuth tokens from macOS Keychain (where claude auth login stores them)
function readFromKeychain(): { accessToken: string; refreshToken?: string; expiresAt?: number } | null {
  if (process.platform !== 'darwin') return null;
  try {
    const output = execSync(
      `security find-generic-password -s "${KEYCHAIN_SERVICE}" -g 2>&1`,
      { encoding: 'utf-8' }
    );
    const match = output.match(/password: "(.+)"/s);
    if (!match) return null;
    const data = JSON.parse(match[1]);
    const oa = data?.claudeAiOauth;
    if (!oa?.accessToken) return null;
    return { accessToken: oa.accessToken, refreshToken: oa.refreshToken, expiresAt: oa.expiresAt };
  } catch {
    return null;
  }
}

// Write updated tokens back to macOS Keychain
function writeToKeychain(tokens: { accessToken: string; refreshToken?: string; expiresAt?: number }) {
  if (process.platform !== 'darwin') return;
  try {
    // Read existing keychain entry to preserve all other fields
    const output = execSync(
      `security find-generic-password -s "${KEYCHAIN_SERVICE}" -g 2>&1`,
      { encoding: 'utf-8' }
    );
    const match = output.match(/password: "(.+)"/s);
    let existing: any = {};
    if (match) { try { existing = JSON.parse(match[1]); } catch {} }

    const updated = {
      ...existing,
      claudeAiOauth: {
        ...(existing.claudeAiOauth ?? {}),
        accessToken:  tokens.accessToken,
        refreshToken: tokens.refreshToken ?? existing.claudeAiOauth?.refreshToken,
        expiresAt:    tokens.expiresAt,
      },
    };
    const json = JSON.stringify(updated);
    execSync(
      `security add-generic-password -U -s "${KEYCHAIN_SERVICE}" -a "${KEYCHAIN_ACCOUNT}" -w ${JSON.stringify(json)}`,
      { encoding: 'utf-8' }
    );
  } catch {}
}

// Account metadata lives in ~/.claude.json (no token there)
function readAccountMeta(): Partial<ClaudeCodeAccount> {
  try {
    const data = JSON.parse(fs.readFileSync(CLAUDE_JSON, 'utf-8'));
    const oa = data?.oauthAccount ?? {};
    return {
      emailAddress:     oa.emailAddress,
      displayName:      oa.displayName,
      accountUuid:      oa.accountUuid,
      organizationName: oa.organizationName,
      billingType:      oa.billingType,
    };
  } catch {
    return {};
  }
}

function readAccount(): ClaudeCodeAccount | null {
  const tokens = readFromKeychain();
  if (!tokens) return null;
  const meta = readAccountMeta();
  return { ...meta, ...tokens } as ClaudeCodeAccount;
}

export function getStatus(): ClaudeCodeStatus {
  // Use account metadata from ~/.claude.json as the connectivity indicator.
  // The binary writes emailAddress/accountUuid there on every successful login,
  // even though the actual token lives in the macOS Keychain.
  const meta = readAccountMeta();
  if (!meta.emailAddress && !meta.accountUuid) return { connected: false };
  return {
    connected:        true,
    emailAddress:     meta.emailAddress,
    displayName:      meta.displayName,
    organizationName: meta.organizationName,
    billingType:      meta.billingType,
  };
}

async function refreshAccessToken(refreshToken: string): Promise<string | null> {
  try {
    const data = await new Promise<any>((resolve, reject) => {
      const body = JSON.stringify({ grant_type: 'refresh_token', refresh_token: refreshToken });
      const parsed = new URL(REFRESH_URL);
      const req = https.request({
        hostname: parsed.hostname,
        path:     parsed.pathname,
        method:   'POST',
        headers: {
          'Content-Type':   'application/json',
          'Accept':         'application/json',
          'User-Agent':     'claude-code/2.1.123',
          'x-service-name': 'claude-code',
          'Content-Length': Buffer.byteLength(body),
        },
      }, (res) => {
        let raw = '';
        res.on('data', (c) => { raw += c; });
        res.on('end', () => {
          try { resolve(JSON.parse(raw)); } catch { reject(new Error(raw)); }
        });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });

    if (!data.access_token) return null;

    const newTokens = {
      accessToken:  data.access_token as string,
      refreshToken: data.refresh_token ?? refreshToken,
      expiresAt:    data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
    };
    writeToKeychain(newTokens);
    return newTokens.accessToken;
  } catch {
    return null;
  }
}

// Returns a valid OAuth access token, refreshing if needed.
export async function getValidToken(): Promise<string | null> {
  const acc = readAccount();
  if (!acc) return null;

  const buffer   = 60_000;
  const isExpired = acc.expiresAt && Date.now() > acc.expiresAt - buffer;

  if (!isExpired) return acc.accessToken;

  if (acc.refreshToken) {
    const fresh = await refreshAccessToken(acc.refreshToken);
    if (fresh) return fresh;
  }

  return acc.accessToken;
}
