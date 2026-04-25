import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';

const CACHE_DIR = path.join(os.homedir(), '.koda', 'cache');

function key(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 16);
}

function cachePath(k: string): string {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  return path.join(CACHE_DIR, `${k}.json`);
}

export function getCached(input: string): string | null {
  const file = cachePath(key(input));
  if (!fs.existsSync(file)) return null;
  try {
    const { content, expires } = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (Date.now() > expires) { fs.unlinkSync(file); return null; }
    return content as string;
  } catch { return null; }
}

export function setCached(input: string, content: string, ttlMs = 86_400_000): void {
  const file = cachePath(key(input));
  fs.writeFileSync(file, JSON.stringify({ content, expires: Date.now() + ttlMs }));
}
