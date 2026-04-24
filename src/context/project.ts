import fs from 'fs';
import path from 'path';
import os from 'os';
import { projectRoot } from '../utils/git.js';

const MAX_CONTEXT_CHARS = 3000;

function findUp(filename: string, startDir: string): string | null {
  let dir = startDir;
  const home = os.homedir();
  while (dir.length >= home.length) {
    const file = path.join(dir, filename);
    if (fs.existsSync(file)) return file;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function packageInfo(cwd: string): string {
  const pkgPath = path.join(cwd, 'package.json');
  if (!fs.existsSync(pkgPath)) return '';
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const allDeps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).slice(0, 15);
    const lines = [`## Package: ${pkg.name ?? 'unnamed'}`];
    if (pkg.description) lines.push(pkg.description);
    if (allDeps.length) lines.push(`Deps: ${allDeps.join(', ')}`);
    return lines.join('\n');
  } catch { return ''; }
}

function dirStructure(cwd: string): string {
  const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '__pycache__']);
  const lines: string[] = [];

  function scan(dir: string, depth: number, prefix: string) {
    if (depth > 2 || lines.length > 40) return;
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (SKIP.has(entry.name) || entry.name.startsWith('.')) continue;
        lines.push(`${prefix}${entry.name}${entry.isDirectory() ? '/' : ''}`);
        if (entry.isDirectory()) scan(path.join(dir, entry.name), depth + 1, `${prefix}  `);
      }
    } catch { /* ignore */ }
  }

  scan(cwd, 0, '');
  return lines.length ? `## Structure\n${lines.join('\n')}` : '';
}

export function loadProjectContext(): string {
  const root = projectRoot();
  const parts: string[] = [];

  const contextFile = findUp('.aicontext', root);
  if (contextFile) {
    const content = fs.readFileSync(contextFile, 'utf-8').slice(0, MAX_CONTEXT_CHARS);
    parts.push(content);
  }

  const pkg = packageInfo(root);
  if (pkg) parts.push(pkg);

  if (!contextFile) {
    const struct = dirStructure(root);
    if (struct) parts.push(struct);
  }

  return parts.join('\n\n').trim();
}

export interface ProjectConfig {
  model?: string;
  baseURL?: string;
  maxTokens?: number;
  contextBudget?: number;
}

export function loadProjectConfig(): ProjectConfig {
  const configFile = findUp('.aiconfig.json', projectRoot());
  if (!configFile) return {};
  try {
    return JSON.parse(fs.readFileSync(configFile, 'utf-8')) as ProjectConfig;
  } catch { return {}; }
}
