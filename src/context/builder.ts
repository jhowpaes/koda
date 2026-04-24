import fs from 'fs';
import path from 'path';
import { estimateTokens } from '../llm/provider.js';
import { loadProjectContext } from './project.js';
import { projectRoot } from '../utils/git.js';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '__pycache__', '.cache', '.turbo']);
const CODE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java', '.cs', '.cpp', '.c', '.rb', '.php', '.swift', '.kt']);
const CONFIG_EXTS = new Set(['.json', '.yaml', '.yml', '.toml', '.md', '.env.example']);
const STOP_WORDS = new Set(['the', 'and', 'for', 'are', 'this', 'that', 'with', 'what', 'how', 'can', 'you', 'use', 'make', 'get', 'set', 'from', 'into', 'have', 'was', 'its']);

const MAX_FILE_LINES = 200;
const MAX_FILES_SCANNED = 300;

function extractKeywords(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[\s.,?!()\[\]{}<>/\\:;'"+=@#$%^&*~`|]+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

function walk(dir: string, depth = 0): string[] {
  if (depth > 6) return [];
  const entries: string[] = [];
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entries.length >= MAX_FILES_SCANNED) break;
      if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) {
        entries.push(...walk(path.join(dir, entry.name), depth + 1));
      } else if (entry.isFile()) {
        entries.push(path.join(dir, entry.name));
      }
    }
  } catch { /* ignore */ }
  return entries;
}

function readFirstLines(filePath: string, n: number): string {
  try {
    return fs.readFileSync(filePath, 'utf-8').split('\n').slice(0, n).join('\n');
  } catch { return ''; }
}

function scoreFile(filePath: string, keywords: string[]): number {
  const name = path.basename(filePath).toLowerCase();
  const ext = path.extname(filePath).toLowerCase();
  let score = 0;

  if (CODE_EXTS.has(ext)) score += 1;
  else if (CONFIG_EXTS.has(ext)) score += 0.5;
  else return 0;

  for (const kw of keywords) {
    if (name.includes(kw)) score += 3;
  }

  const preview = readFirstLines(filePath, 20).toLowerCase();
  for (const kw of keywords) {
    if (preview.includes(kw)) score += 2;
  }

  return score;
}

function truncate(content: string, budgetTokens: number): string {
  const maxChars = budgetTokens * 4;
  if (content.length <= maxChars) return content;
  return content.slice(0, maxChars) + '\n... [truncated]';
}

export function buildContext(query: string, budgetTokens = 8000): string {
  const keywords = extractKeywords(query);
  if (keywords.length === 0) return '';

  const root = projectRoot();
  const files = walk(root);
  const scored = files
    .map(f => ({ file: f, score: scoreFile(f, keywords) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  if (scored.length === 0) return '';

  const perFile = Math.floor(budgetTokens / scored.length);
  return scored
    .map(({ file }) => {
      try {
        const rel = path.relative(root, file);
        const content = readFirstLines(file, MAX_FILE_LINES);
        const ext = path.extname(file).slice(1);
        return `### ${rel}\n\`\`\`${ext}\n${truncate(content, perFile)}\n\`\`\``;
      } catch { return ''; }
    })
    .filter(Boolean)
    .join('\n\n');
}

export function buildFileContext(filePath: string, budgetTokens = 10000): string {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  if (lines.length > 500) {
    console.warn(`Warning: ${path.basename(filePath)} has ${lines.length} lines — reading first 500.`);
  }
  const ext = path.extname(filePath).slice(1);
  const rel = path.relative(projectRoot(), filePath);
  return `### ${rel}\n\`\`\`${ext}\n${truncate(lines.slice(0, 500).join('\n'), budgetTokens)}\n\`\`\``;
}

export function buildSystemPrompt(basePrompt: string): string {
  const projectCtx = loadProjectContext();
  if (!projectCtx) return basePrompt;
  return `${basePrompt}\n\n---\n${projectCtx}`;
}
