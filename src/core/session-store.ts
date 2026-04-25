import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import type { Message } from '../llm/types.js';
import { projectRoot } from '../utils/git.js';

const SESSIONS_DIR = path.join(os.homedir(), '.koda', 'sessions');
const MAX_MESSAGES = 20;

interface Session {
  cwd: string;
  messages: Message[];
  model?: string;
  createdAt: string;
  updatedAt: string;
}

function sessionPath(cwd: string): string {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  const hash = crypto.createHash('md5').update(cwd).digest('hex').slice(0, 8);
  return path.join(SESSIONS_DIR, `${hash}.json`);
}

export function currentProjectKey(): string { return projectRoot(); }

export function loadSession(cwd: string): Session | null {
  const file = sessionPath(cwd);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as Session;
  } catch { return null; }
}

export function saveSession(cwd: string, messages: Message[], model?: string): void {
  const file = sessionPath(cwd);
  const existing = loadSession(cwd);
  const session: Session = {
    cwd,
    messages: messages.slice(-MAX_MESSAGES),
    model,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(file, JSON.stringify(session, null, 2));
}

export function clearSession(cwd: string): void {
  const file = sessionPath(cwd);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}
