import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

function detect(): string {
  // 1. git root
  try {
    return execSync('git rev-parse --show-toplevel', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch { /* not a git repo */ }

  // 2. nearest package.json
  let dir = process.cwd();
  while (true) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // 3. fallback to cwd
  return process.cwd();
}

let _root: string | null = null;

export function projectRoot(): string {
  if (!_root) _root = detect();
  return _root;
}

export function setProjectRoot(root: string): void {
  _root = root;
}
