import fs from 'fs';
import path from 'path';
import os from 'os';
import type { WorkspaceConfig, ResolvedAgentConfig } from './types.js';

const KODA_DIR      = path.join(os.homedir(), '.koda');
const WORKSPACES_DIR = path.join(KODA_DIR, 'workspaces');
const ACTIVE_FILE   = path.join(KODA_DIR, 'active');

function ensureDirs(): void {
  fs.mkdirSync(WORKSPACES_DIR, { recursive: true });
}

function workspacePath(name: string): string {
  return path.join(WORKSPACES_DIR, name);
}

function configPath(name: string): string {
  return path.join(workspacePath(name), 'config.json');
}

// ─── Read ────────────────────────────────────────────────────────────────────

export function listWorkspaces(): string[] {
  ensureDirs();
  return fs.readdirSync(WORKSPACES_DIR).filter(entry => {
    return fs.existsSync(configPath(entry));
  });
}

export function loadWorkspace(name: string): WorkspaceConfig | null {
  const p = configPath(name);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as WorkspaceConfig;
  } catch { return null; }
}

export function getActive(): string | null {
  if (!fs.existsSync(ACTIVE_FILE)) return null;
  const name = fs.readFileSync(ACTIVE_FILE, 'utf-8').trim();
  // Validate the active workspace still exists
  return loadWorkspace(name) ? name : null;
}

export function getActiveWorkspace(): WorkspaceConfig | null {
  const name = getActive();
  return name ? loadWorkspace(name) : null;
}

// ─── Write ───────────────────────────────────────────────────────────────────

export function saveWorkspace(cfg: WorkspaceConfig): void {
  ensureDirs();
  const dir = workspacePath(cfg.name);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'sessions'), { recursive: true });
  fs.writeFileSync(configPath(cfg.name), JSON.stringify(cfg, null, 2), 'utf-8');
}

export function setActive(name: string): void {
  if (!loadWorkspace(name)) throw new Error(`Workspace not found: ${name}`);
  ensureDirs();
  fs.writeFileSync(ACTIVE_FILE, name, 'utf-8');
}

export function deleteWorkspace(name: string): void {
  const dir = workspacePath(name);
  if (!fs.existsSync(dir)) throw new Error(`Workspace not found: ${name}`);
  fs.rmSync(dir, { recursive: true, force: true });
  // Clear active if it was this workspace
  if (getActive() === name) fs.rmSync(ACTIVE_FILE, { force: true });
}

// ─── Config resolution ───────────────────────────────────────────────────────

export function resolveAgentConfig(
  ws: WorkspaceConfig,
  agent: 'code' | 'review' | 'git'
): ResolvedAgentConfig {
  const override = ws.agents[agent] ?? {};
  return {
    provider:  override.provider  ?? ws.ceo.provider,
    apiKey:    override.apiKey    ?? ws.ceo.apiKey,
    baseURL:   override.baseURL   ?? ws.ceo.baseURL,
    model:     override.model     ?? ws.ceo.model,
    maxTokens: override.maxTokens ?? ws.ceo.maxTokens ?? 4096,
  };
}

// Returns env vars to inject when spawning an agent MCP server subprocess
export function agentEnv(ws: WorkspaceConfig, agent: 'code' | 'review' | 'git'): Record<string, string> {
  const cfg = resolveAgentConfig(ws, agent);
  const env: Record<string, string> = {
    LLM_PROVIDER:   cfg.provider,
    LLM_API_KEY:    cfg.apiKey,
    LLM_MODEL:      cfg.model,
    LLM_MAX_TOKENS: String(cfg.maxTokens),
  };
  if (cfg.baseURL) env.LLM_BASE_URL = cfg.baseURL;
  return env;
}
