import { app, BrowserWindow, ipcMain, dialog, systemPreferences } from 'electron';
import path from 'path';
import fs from 'fs';
import { execSync, exec, spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
import Anthropic from '@anthropic-ai/sdk';

const isDev = process.env.NODE_ENV === 'development' || !!process.env['ELECTRON_RENDERER_URL'];

let _agent: import('../src/core/agent.js').Agent | null = null;
let _currentRoot: string | null = null;
let runningShell: ChildProcess | null = null;
const agentAbortControllers = new Map<string, AbortController>();

async function getAgent(root: string) {
  const { Agent } = await import('../src/core/agent.js');
  const { createProvider } = await import('../src/llm/provider.js');
  const { loadProjectConfig } = await import('../src/context/project.js');
  const { setProjectRoot } = await import('../src/utils/git.js');
  const { config } = await import('../src/config.js');

  if (_agent && _currentRoot === root) return _agent;

  setProjectRoot(root);
  _currentRoot = root;

  const projCfg = loadProjectConfig();
  const merged = {
    ...config,
    model: projCfg.model ?? config.model,
    maxTokens: projCfg.maxTokens ?? config.maxTokens,
    contextBudget: projCfg.contextBudget ?? config.contextBudget,
  };

  _agent = new Agent(createProvider(merged), merged.model);
  return _agent;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#1e1e1e',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: false,
    },
  });

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL']);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }


  return win;
}

// Single-instance lock — enables `koda .` CLI to open paths in a running instance
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_, argv) => {
    const wins = BrowserWindow.getAllWindows();
    if (wins.length > 0) {
      const win = wins[0];
      if (win.isMinimized()) win.restore();
      win.focus();
    }
    const idx = argv.indexOf('--open-path');
    if (idx >= 0 && argv[idx + 1]) {
      BrowserWindow.getAllWindows()[0]?.webContents.send('app:openPath', argv[idx + 1]);
    }
  });

  app.whenReady().then(() => {
    const win = createWindow();

    const idx = process.argv.indexOf('--open-path');
    if (idx >= 0 && process.argv[idx + 1]) {
      const pathToOpen = process.argv[idx + 1];
      win.webContents.once('did-finish-load', () => {
        win.webContents.send('app:openPath', pathToOpen);
      });
    }

    // Watch ~/.claude.json and notify renderer when the account changes
    watchClaudeJson(win);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (runningShell) runningShell.kill();
  if (process.platform !== 'darwin') app.quit();
});

// ─── Claude Code account watcher ─────────────────────────────────────────────

import os from 'os';
const CLAUDE_JSON_PATH = path.join(os.homedir(), '.claude.json');

function watchClaudeJson(win: BrowserWindow) {
  if (!fs.existsSync(CLAUDE_JSON_PATH)) return;

  let debounce: ReturnType<typeof setTimeout> | null = null;

  fs.watch(CLAUDE_JSON_PATH, () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(async () => {
      try {
        const { getStatus } = await import('./claude-code-auth.js');
        const status = getStatus();
        if (!win.isDestroyed()) {
          win.webContents.send('claudecode:account:changed', status);
        }
      } catch {}
    }, 300);
  });
}

// ─── IPC: permissions ────────────────────────────────────────────────────────

ipcMain.handle('permissions:microphone', async () => {
  if (process.platform !== 'darwin') return { granted: true };
  try {
    const granted = await systemPreferences.askForMediaAccess('microphone');
    return { granted };
  } catch {
    return { granted: false };
  }
});

// ─── IPC: project ─────────────────────────────────────────────────────────────

ipcMain.handle('dialog:openProject', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  if (!result.canceled && result.filePaths[0]) {
    _agent = null;
    return result.filePaths[0];
  }
  return null;
});

ipcMain.handle('fs:tree', (_, dir: string) => readTree(dir, 0));

ipcMain.handle('fs:readFile', (_, filePath: string) => {
  try { return fs.readFileSync(filePath, 'utf-8'); } catch { return null; }
});

ipcMain.handle('fs:readBinary', (_, filePath: string) => {
  try { return fs.readFileSync(filePath).toString('base64'); } catch { return null; }
});

ipcMain.handle('fs:writeFile', (_, { filePath, content }: { filePath: string; content: string }) => {
  try { fs.writeFileSync(filePath, content, 'utf-8'); return { ok: true }; }
  catch (e) { return { error: (e as Error).message }; }
});

ipcMain.handle('koda:loadHistory', (_, projectRoot: string) => {
  try {
    const file = path.join(projectRoot, '.koda', 'koda-history.json');
    if (!fs.existsSync(file)) return [];
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch { return []; }
});

ipcMain.handle('koda:saveHistory', (_, { projectRoot, entry }: { projectRoot: string; entry: unknown }) => {
  try {
    const dir  = path.join(projectRoot, '.koda');
    const file = path.join(dir, 'koda-history.json');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const existing: unknown[] = fs.existsSync(file)
      ? JSON.parse(fs.readFileSync(file, 'utf-8'))
      : [];
    const updated = [entry, ...existing].slice(0, 100); // keep last 100
    fs.writeFileSync(file, JSON.stringify(updated, null, 2), 'utf-8');
    return { ok: true };
  } catch (e) { return { error: (e as Error).message }; }
});

ipcMain.handle('fs:loadChats', (_, projectRoot: string) => {
  try {
    const raw = fs.readFileSync(path.join(projectRoot, '.koda', 'chats.json'), 'utf-8');
    return JSON.parse(raw);
  } catch { return null; }
});

ipcMain.handle('fs:saveChats', (_, { projectRoot, chats }: { projectRoot: string; chats: unknown[] }) => {
  try {
    const dir = path.join(projectRoot, '.koda');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'chats.json'), JSON.stringify(chats, null, 2), 'utf-8');
    return { ok: true };
  } catch (e) { return { error: (e as Error).message }; }
});

// ─── IPC: shell runner ─────────────────────────────────────────────────────────

ipcMain.on('shell:run', (event, { root, command }: { root: string; command: string }) => {
  if (runningShell) { runningShell.kill('SIGTERM'); runningShell = null; }

  const proc = spawn(command, { cwd: root, shell: true });
  runningShell = proc;

  proc.stdout?.on('data', data => event.sender.send('shell:output', data.toString(), 'stdout'));
  proc.stderr?.on('data', data => event.sender.send('shell:output', data.toString(), 'stderr'));
  proc.on('close', code => {
    runningShell = null;
    event.sender.send('shell:done', code);
  });
});

ipcMain.handle('shell:kill', () => {
  if (runningShell) { runningShell.kill('SIGTERM'); runningShell = null; }
  return { ok: true };
});

// ─── IPC: agent streaming ─────────────────────────────────────────────────────

ipcMain.handle('agent:stop', (event, chatId?: string) => {
  if (chatId) {
    agentAbortControllers.get(chatId)?.abort();
    agentAbortControllers.delete(chatId);
    event.sender.send('agent:done', chatId);
  } else {
    agentAbortControllers.forEach((ctrl, cid) => {
      ctrl.abort();
      event.sender.send('agent:done', cid);
    });
    agentAbortControllers.clear();
  }
});

ipcMain.on('agent:chat', async (event, { root, chatId, message }: { root: string; chatId: string; message: string }) => {
  try {
    const agent = await getAgent(root);
    await agent.chat(message, chunk => event.sender.send('agent:chunk', chatId, chunk));
  } catch (e) {
    event.sender.send('agent:chunk', chatId, `\n\n**Error:** ${(e as Error).message}`);
  }
  event.sender.send('agent:done', chatId);
});

ipcMain.on('agent:ask', async (event, { root, chatId, message }: { root: string; chatId: string; message: string }) => {
  try {
    const agent = await getAgent(root);
    const { config } = await import('../src/config.js');
    await agent.ask(message, config.contextBudget, chunk => event.sender.send('agent:chunk', chatId, chunk));
  } catch (e) {
    event.sender.send('agent:chunk', chatId, `\n\n**Error:** ${(e as Error).message}`);
  }
  event.sender.send('agent:done', chatId);
});

ipcMain.on('agent:explain', async (event, { root, chatId, filePath }: { root: string; chatId: string; filePath: string }) => {
  try {
    const agent = await getAgent(root);
    const { buildFileContext } = await import('../src/context/builder.js');
    const ctx = buildFileContext(filePath);
    await agent.callWithSystemPrompt(
      'You are an expert engineer. Explain what this file does: its purpose, key functions, and dependencies. Be concise. Respond in the user\'s language.',
      `Explain:\n\n${ctx}`,
      chunk => event.sender.send('agent:chunk', chatId, chunk)
    );
  } catch (e) {
    event.sender.send('agent:chunk', chatId, `\n\n**Error:** ${(e as Error).message}`);
  }
  event.sender.send('agent:done', chatId);
});

ipcMain.on('agent:review', async (event, { root, chatId, filePath }: { root: string; chatId: string; filePath: string }) => {
  try {
    const agent = await getAgent(root);
    const { buildFileContext } = await import('../src/context/builder.js');
    const ctx = buildFileContext(filePath);
    await agent.callWithSystemPrompt(
      'You are a senior code reviewer. Provide a structured review with: Issues (with line refs), Suggestions, and Overall summary. Be concise.',
      `Review:\n\n${ctx}`,
      chunk => event.sender.send('agent:chunk', chatId, chunk)
    );
  } catch (e) {
    event.sender.send('agent:chunk', chatId, `\n\n**Error:** ${(e as Error).message}`);
  }
  event.sender.send('agent:done', chatId);
});

// ─── IPC: edit ────────────────────────────────────────────────────────────────

ipcMain.handle('agent:editRequest', async (_, { root, filePath, instruction }: {
  root: string; filePath: string; instruction: string;
}) => {
  try {
    const agent = await getAgent(root);
    const { extractCodeBlock } = await import('../src/actions/editor.js');
    const response = await agent.editSilent(filePath, instruction);
    const modified = extractCodeBlock(response);
    if (!modified) return { error: 'No code block in response' };
    const original = fs.readFileSync(filePath, 'utf-8');
    return { original, modified, filePath };
  } catch (e) {
    return { error: (e as Error).message };
  }
});

ipcMain.handle('agent:applyEdit', (_, { filePath, content }: { filePath: string; content: string }) => {
  try {
    fs.writeFileSync(filePath, content, 'utf-8');
    return { ok: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
});

// ─── IPC: git ─────────────────────────────────────────────────────────────────

ipcMain.handle('git:diff', (_, root: string) => {
  try {
    const diff = execSync('git diff --cached', { cwd: root, encoding: 'utf-8', maxBuffer: 2 * 1024 * 1024 });
    return diff;
  } catch { return ''; }
});

ipcMain.handle('git:commit', (_, { root, message }: { root: string; message: string }) => {
  try { execSync(`git commit -m ${JSON.stringify(message)}`, { cwd: root }); return { ok: true }; }
  catch (e) { return { error: (e as Error).message }; }
});

ipcMain.handle('git:status', (_, root: string) => {
  try {
    const out = execSync('git status --porcelain', { cwd: root, encoding: 'utf-8' });
    return out.split('\n').filter(Boolean).map(line => ({
      xy: line.slice(0, 2),
      path: line.slice(3),
    }));
  } catch { return []; }
});

ipcMain.handle('git:fileDiff', (_, { root, filePath, staged }: { root: string; filePath: string; staged: boolean }) => {
  try {
    const cmd = staged ? `git diff --cached -- "${filePath}"` : `git diff -- "${filePath}"`;
    return execSync(cmd, { cwd: root, encoding: 'utf-8' });
  } catch { return ''; }
});

ipcMain.handle('git:stage', (_, { root, filePath }: { root: string; filePath: string }) => {
  try { execSync(`git add -- "${filePath}"`, { cwd: root }); return { ok: true }; }
  catch (e) { return { error: (e as Error).message }; }
});

ipcMain.handle('git:unstage', (_, { root, filePath }: { root: string; filePath: string }) => {
  try { execSync(`git restore --staged -- "${filePath}"`, { cwd: root }); return { ok: true }; }
  catch (e) { return { error: (e as Error).message }; }
});

ipcMain.handle('git:discard', (_, { root, filePath }: { root: string; filePath: string }) => {
  try {
    execSync(`git checkout -- "${filePath}"`, { cwd: root });
    return { ok: true };
  } catch (e) { return { error: (e as Error).message }; }
});

ipcMain.handle('git:log', (_, { root, limit }: { root: string; limit?: number }) => {
  try {
    const out = execSync(`git log --oneline -${limit ?? 20}`, { cwd: root, encoding: 'utf-8' });
    return out.split('\n').filter(Boolean).map(line => ({
      hash: line.slice(0, 7),
      message: line.slice(8),
    }));
  } catch { return []; }
});

ipcMain.handle('git:commitDiff', (_, { root, hash }: { root: string; hash: string }) => {
  try {
    return execSync(`git show ${hash}`, { cwd: root, encoding: 'utf-8', maxBuffer: 4 * 1024 * 1024 });
  } catch { return ''; }
});

ipcMain.handle('git:branch', (_, root: string) => {
  try { return execSync('git branch --show-current', { cwd: root, encoding: 'utf-8' }).trim(); }
  catch { return ''; }
});

ipcMain.handle('git:branches', (_, root: string) => {
  try {
    return execSync('git branch', { cwd: root, encoding: 'utf-8' })
      .split('\n').filter(Boolean)
      .map(b => ({ name: b.replace(/^\*?\s+/, ''), current: b.trimStart().startsWith('*') }));
  } catch { return []; }
});

ipcMain.handle('git:checkout', (_, { root, branch }: { root: string; branch: string }) => {
  try { execSync(`git checkout "${branch}"`, { cwd: root }); return { ok: true }; }
  catch (e) { return { error: (e as Error).message }; }
});

ipcMain.handle('git:push', (_, root: string) => {
  try { execSync('git push', { cwd: root, encoding: 'utf-8', timeout: 30000 }); return { ok: true }; }
  catch (e) { return { error: (e as Error).message }; }
});

ipcMain.handle('git:pull', (_, root: string) => {
  try { execSync('git pull', { cwd: root, encoding: 'utf-8', timeout: 30000 }); return { ok: true }; }
  catch (e) { return { error: (e as Error).message }; }
});

// ─── IPC: commit generation ───────────────────────────────────────────────────

ipcMain.handle('agent:commit', async (_, {
  diff, apiKey, baseUrl, model,
}: { root: string; diff: string; apiKey: string; baseUrl: string; model: string }) => {
  try {
    if (!apiKey) return { error: 'No API key configured. Go to Settings → Providers.' };
    if (!diff.trim()) return { error: 'No changes detected.' };

    const system = 'You are an expert at writing conventional commit messages. Return ONLY the commit message (subject line + optional body), no extra explanation.';
    const prompt = `Generate a commit message for these changes:\n\n${diff.slice(0, 14000)}`;
    const isAnthropic = model.startsWith('claude') || (baseUrl ?? '').includes('anthropic');

    if (isAnthropic) {
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey });
      const res = await client.messages.create({
        model,
        max_tokens: 256,
        system,
        messages: [{ role: 'user', content: prompt }],
      });
      const block = res.content.find(b => b.type === 'text');
      return { message: block && block.type === 'text' ? block.text.trim() : '' };
    } else {
      const { default: OpenAI } = await import('openai');
      const client = new OpenAI({ apiKey, baseURL: baseUrl || undefined });
      const res = await client.chat.completions.create({
        model,
        max_tokens: 256,
        messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
      });
      return { message: res.choices[0]?.message?.content?.trim() ?? '' };
    }
  } catch (e) {
    return { error: (e as Error).message };
  }
});

// ─── IPC: Anthropic agentic streaming ────────────────────────────────────────

type AgentEvent =
  | { type: 'thinking_start' }
  | { type: 'thinking_delta'; text: string }
  | { type: 'thinking_end'; elapsed: number }
  | { type: 'tool_start'; name: string; label: string }
  | { type: 'tool_end'; name: string }
  | { type: 'text_delta'; text: string }
  | { type: 'error'; message: string };

const AGENTIC_TOOLS: Anthropic.Tool[] = [
  {
    name: 'read_file',
    description: 'Read a file. Returns up to 200 lines. If the file is larger, use read_file_lines to read specific sections.',
    input_schema: {
      type: 'object' as const,
      properties: { path: { type: 'string', description: 'File path (absolute or relative to project root)' } },
      required: ['path'],
    },
  },
  {
    name: 'read_file_lines',
    description: 'Read specific lines from a file. Prefer this for large files or when you only need a section.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'File path (absolute or relative to project root)' },
        from_line: { type: 'number', description: 'Start line (1-indexed, inclusive)' },
        to_line: { type: 'number', description: 'End line (inclusive)' },
      },
      required: ['path', 'from_line', 'to_line'],
    },
  },
  {
    name: 'write_file',
    description: 'Create or overwrite a file. Always read the file first before editing.',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'File path (absolute or relative to project root)' },
        content: { type: 'string', description: 'Full file content to write' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'list_dir',
    description: 'List files and subdirectories. Use to explore structure before reading files.',
    input_schema: {
      type: 'object' as const,
      properties: { path: { type: 'string', description: 'Directory path (absolute or relative to project root)' } },
      required: ['path'],
    },
  },
  {
    name: 'search_files',
    description: 'Search file contents with grep. Use this BEFORE read_file to find exactly where relevant code is.',
    input_schema: {
      type: 'object' as const,
      properties: {
        pattern: { type: 'string', description: 'Search pattern (grep-compatible regex)' },
        directory: { type: 'string', description: 'Directory to search (default: project root)' },
        file_pattern: { type: 'string', description: 'Glob for file types, e.g. "*.ts" (default: common code files)' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'bash',
    description: 'Run a shell command (build, test, git, etc.). Output truncated to 100 lines.',
    input_schema: {
      type: 'object' as const,
      properties: { command: { type: 'string', description: 'Shell command to run' } },
      required: ['command'],
    },
  },
];

function resolveAgenticPath(root: string, p: string): string {
  return path.isAbsolute(p) ? p : path.join(root, p);
}

const READ_MAX_LINES = 200;
const SEARCH_MAX_LINES = 60;
const BASH_MAX_LINES = 100;

function truncate(text: string, maxLines: number, hint: string): string {
  const lines = text.split('\n');
  if (lines.length <= maxLines) return text;
  return lines.slice(0, maxLines).join('\n') + `\n[... ${lines.length - maxLines} more lines truncated — ${hint}]`;
}

async function runTool(root: string, name: string, input: Record<string, string>): Promise<string> {
  try {
    switch (name) {
      case 'read_file': {
        const fp = resolveAgenticPath(root, input.path);
        const content = fs.readFileSync(fp, 'utf-8');
        const lines = content.split('\n');
        if (lines.length > READ_MAX_LINES) {
          return lines.slice(0, READ_MAX_LINES).join('\n')
            + `\n[File has ${lines.length} lines total. Use read_file_lines(path, from_line, to_line) to read more.]`;
        }
        return content;
      }
      case 'read_file_lines': {
        const fp = resolveAgenticPath(root, input.path);
        const lines = fs.readFileSync(fp, 'utf-8').split('\n');
        const from = Math.max(1, Number(input.from_line) || 1) - 1;
        const to = Math.min(lines.length, Number(input.to_line) || lines.length);
        return `[Lines ${from + 1}–${to} of ${lines.length}]\n` + lines.slice(from, to).join('\n');
      }
      case 'write_file': {
        const fp = resolveAgenticPath(root, input.path);
        fs.mkdirSync(path.dirname(fp), { recursive: true });
        fs.writeFileSync(fp, input.content, 'utf-8');
        return `Written: ${input.path}`;
      }
      case 'list_dir': {
        const dp = resolveAgenticPath(root, input.path ?? '.');
        return fs.readdirSync(dp, { withFileTypes: true })
          .map(e => `${e.isDirectory() ? 'd' : 'f'} ${e.name}`)
          .join('\n');
      }
      case 'search_files': {
        const dir = input.directory ? resolveAgenticPath(root, input.directory) : root;
        const fileGlob = input.file_pattern
          ? `--include=${JSON.stringify(input.file_pattern)}`
          : '--include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" --include="*.py" --include="*.go" --include="*.rs" --include="*.swift" --include="*.kt"';
        try {
          const { stdout } = await execAsync(
            `grep -r -n ${fileGlob} ${JSON.stringify(input.pattern)} ${JSON.stringify(dir)}`,
            { encoding: 'utf-8', timeout: 15000 }
          );
          return truncate(stdout.trim(), SEARCH_MAX_LINES, 'refine your search pattern or specify a subdirectory');
        } catch (e: any) {
          const stdout = (e.stdout ?? '').trim();
          return stdout ? truncate(stdout, SEARCH_MAX_LINES, 'refine pattern') : 'No matches found';
        }
      }
      case 'bash': {
        const { stdout, stderr } = await execAsync(input.command, { cwd: root, encoding: 'utf-8', timeout: 120000 });
        const out = (stdout + (stderr ? `\n[stderr]\n${stderr}` : '')).trim();
        return truncate(out, BASH_MAX_LINES, 'use a more specific command');
      }
      default:
        return 'Unknown tool';
    }
  } catch (e) {
    return `Error: ${(e as Error).message}`;
  }
}

function toolLabel(name: string, input: Record<string, string>): string {
  switch (name) {
    case 'read_file':      return `Read ${input.path ?? ''}`;
    case 'read_file_lines':return `Read ${input.path ?? ''} :${input.from_line}–${input.to_line}`;
    case 'write_file':     return `Write ${input.path ?? ''}`;
    case 'list_dir':       return `List ${input.path ?? '.'}`;
    case 'search_files':   return `Search "${input.pattern ?? ''}"`;
    case 'bash':           return `Run: ${(input.command ?? '').slice(0, 60)}`;
    default:               return name;
  }
}

function supportsThinking(model: string): boolean {
  return /^claude-(3-7|opus-4|sonnet-4|haiku-4)/.test(model);
}

// Tools whose outputs are worth capturing for inter-step context
const CONTEXT_CAPTURE_TOOLS = new Set(['search_files', 'bash', 'list_dir']);

async function runAnthropicAgentic(
  sender: Electron.WebContents,
  chatId: string,
  root: string, message: string, apiKey: string, model: string,
  signal: AbortSignal,
  customSystemPrompt?: string,
  maxTurns = 20,
  useOAuth = false,
): Promise<string> {
  let finalText = '';
  const toolLog: string[] = [];  // compact capture of key tool results for inter-step context
  const emit = (ev: AgentEvent) => sender.send('agent:event', { chatId, ...ev });
  const client = useOAuth ? new Anthropic({ authToken: apiKey }) : new Anthropic({ apiKey });
  const useThinking = supportsThinking(model);
  const systemPrompt = customSystemPrompt
    ? `${customSystemPrompt}\n\n---\n${agenticSystemPrompt(root)}`
    : agenticSystemPrompt(root);
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: message }];

  for (let turn = 0; turn < maxTurns; turn++) {
    if (signal.aborted) break;
    const params = {
      model, system: systemPrompt, tools: AGENTIC_TOOLS, messages,
      max_tokens: useThinking ? 16000 : 8192,
      ...(useThinking ? { thinking: { type: 'enabled', budget_tokens: 8000 } } : {}),
    };

    const stream = client.messages.stream(params as any, { signal });
    const blockTypes: Record<number, string> = {};
    const toolInputs: Record<number, string> = {};
    const toolMeta: Record<number, { id: string; name: string }> = {};
    let thinkingStart = 0;

    for await (const ev of stream) {
      if (signal.aborted) break;
      if (ev.type === 'content_block_start') {
        const block = ev.content_block;
        blockTypes[ev.index] = block.type;
        if (block.type === 'thinking') {
          thinkingStart = Date.now();
          emit({ type: 'thinking_start' });
        } else if (block.type === 'tool_use') {
          toolMeta[ev.index] = { id: block.id, name: block.name };
          toolInputs[ev.index] = '';
          emit({ type: 'tool_start', name: block.name, label: block.name });
        }
      } else if (ev.type === 'content_block_delta') {
        const delta = ev.delta;
        if (delta.type === 'thinking_delta') emit({ type: 'thinking_delta', text: delta.thinking });
        else if (delta.type === 'text_delta') { emit({ type: 'text_delta', text: delta.text }); finalText += delta.text; }
        else if (delta.type === 'input_json_delta') toolInputs[ev.index] = (toolInputs[ev.index] ?? '') + delta.partial_json;
      } else if (ev.type === 'content_block_stop') {
        const btype = blockTypes[ev.index];
        if (btype === 'thinking') {
          emit({ type: 'thinking_end', elapsed: Math.round((Date.now() - thinkingStart) / 1000) });
        } else if (btype === 'tool_use') {
          let input: Record<string, string> = {};
          try { input = JSON.parse(toolInputs[ev.index] || '{}'); } catch {}
          emit({ type: 'tool_start', name: toolMeta[ev.index].name, label: toolLabel(toolMeta[ev.index].name, input) });
        }
      }
    }

    if (signal.aborted) break;
    const final = await stream.finalMessage();
    messages.push({ role: 'assistant', content: final.content });
    if (final.stop_reason !== 'tool_use') break;

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of final.content) {
      if (block.type !== 'tool_use') continue;
      const input = block.input as Record<string, string>;
      const result = await runTool(root, block.name, input);
      emit({ type: 'tool_end', name: block.name });
      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
      // Capture key tool results so subsequent steps can use them without re-searching
      if (CONTEXT_CAPTURE_TOOLS.has(block.name)) {
        const label = toolLabel(block.name, input);
        const snippet = result.length > 500 ? result.slice(0, 500).trimEnd() + '…' : result;
        toolLog.push(`[${label}]\n${snippet}`);
      }
    }
    messages.push({ role: 'user', content: toolResults });
  }

  // If the agent produced no (or very short) text, append the tool log so
  // subsequent steps have concrete findings instead of an empty context.
  if (toolLog.length > 0 && finalText.trim().length < 100) {
    finalText += (finalText ? '\n\n' : '') + '## Achados das ferramentas\n' + toolLog.join('\n\n');
  }

  return finalText;
}

async function runOpenAIAgentic(
  sender: Electron.WebContents,
  chatId: string,
  root: string, message: string, apiKey: string, baseUrl: string, model: string,
  signal: AbortSignal,
  customSystemPrompt?: string,
  maxTurns = 20,
): Promise<string> {
  let finalText = '';
  const toolLog: string[] = [];
  const emit = (ev: AgentEvent) => sender.send('agent:event', { chatId, ...ev });
  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({ apiKey, baseURL: baseUrl || undefined });

  const oaiTools = AGENTIC_TOOLS.map(t => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));

  const baseSystem = agenticSystemPrompt(root);
  const systemContent = customSystemPrompt
    ? `${customSystemPrompt}\n\n---\n${baseSystem}`
    : baseSystem;

  const messages: any[] = [
    { role: 'system', content: systemContent },
    { role: 'user', content: message },
  ];

  for (let turn = 0; turn < maxTurns; turn++) {
    if (signal.aborted) break;
    const tcMap: Record<number, { id: string; name: string; args: string }> = {};

    const stream = await client.chat.completions.create({
      model, messages, tools: oaiTools, tool_choice: 'auto', stream: true,
    }, { signal });

    for await (const chunk of stream) {
      if (signal.aborted) break;
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;
      if (delta.content) { emit({ type: 'text_delta', text: delta.content }); finalText += delta.content; }
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          if (!tcMap[idx]) {
            const name = tc.function?.name ?? '';
            tcMap[idx] = { id: tc.id ?? '', name, args: '' };
            emit({ type: 'tool_start', name, label: name });
          }
          if (tc.id) tcMap[idx].id = tc.id;
          if (tc.function?.arguments) tcMap[idx].args += tc.function.arguments;
        }
      }
    }

    if (signal.aborted || !Object.keys(tcMap).length) break;

    const toolCalls = Object.values(tcMap).map(tc => ({
      id: tc.id, type: 'function' as const,
      function: { name: tc.name, arguments: tc.args },
    }));
    messages.push({ role: 'assistant', content: null, tool_calls: toolCalls });

    for (const tc of Object.values(tcMap)) {
      if (signal.aborted) break;
      let input: Record<string, string> = {};
      try { input = JSON.parse(tc.args || '{}'); } catch {}
      emit({ type: 'tool_start', name: tc.name, label: toolLabel(tc.name, input) });
      const result = await runTool(root, tc.name, input);
      emit({ type: 'tool_end', name: tc.name });
      messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
      if (CONTEXT_CAPTURE_TOOLS.has(tc.name)) {
        const label = toolLabel(tc.name, input);
        const snippet = result.length > 500 ? result.slice(0, 500).trimEnd() + '…' : result;
        toolLog.push(`[${label}]\n${snippet}`);
      }
    }
  }

  if (toolLog.length > 0 && finalText.trim().length < 100) {
    finalText += (finalText ? '\n\n' : '') + '## Achados das ferramentas\n' + toolLog.join('\n\n');
  }

  return finalText;
}

function agenticSystemPrompt(root: string): string {
  let memory = '';
  try {
    memory = fs.readFileSync(path.join(root, '.codeai', 'MEMORY.md'), 'utf-8').trim();
  } catch {}

  const base = `You are an expert software engineer. Project root: ${root}

## Non-negotiable rules
1. NEVER answer from training memory — always verify by reading the actual files first.
2. Use search_files to locate relevant code BEFORE opening files.
3. Use read_file_lines for large files — read only the section you need.
4. Minimize tool calls: plan what you need before executing.
5. After editing: verify the result makes sense before responding.
6. If you are unsure about a fact in the codebase, look it up. Never guess.

## Tool strategy
- Exploring? → list_dir on relevant dirs only
- Finding a symbol/function? → search_files first, then read_file_lines around the match
- Editing a file? → read the relevant section → write_file with full updated content
- Building/testing? → bash
- Saving project context for future sessions? → write_file(".codeai/MEMORY.md", content)

## Response style
- Concise and complete — no filler, no repetition
- Respond in the same language the user writes`;

  return memory
    ? `${base}\n\n## Project Memory (from previous sessions)\n${memory}`
    : base;
}

ipcMain.on('agent:chat:agentic', async (event, {
  root, chatId, message, apiKey, baseUrl, model, isAnthropic, useOAuth, systemPrompt,
}: { root: string; chatId: string; message: string; apiKey: string; baseUrl: string; model: string; isAnthropic: boolean; useOAuth?: boolean; systemPrompt?: string }) => {
  const sender = event.sender;
  agentAbortControllers.get(chatId)?.abort();
  const ctrl = new AbortController();
  agentAbortControllers.set(chatId, ctrl);
  try {
    if (isAnthropic || useOAuth) {
      await runAnthropicAgentic(sender, chatId, root, message, apiKey, model, ctrl.signal, systemPrompt, 20, useOAuth);
    } else {
      await runOpenAIAgentic(sender, chatId, root, message, apiKey, baseUrl, model, ctrl.signal, systemPrompt);
    }
  } catch (e: any) {
    if (e?.name !== 'AbortError' && e?.code !== 'ERR_CANCELED') {
      sender.send('agent:event', { chatId, type: 'error', message: (e as Error).message });
    }
  } finally {
    agentAbortControllers.delete(chatId);
  }
  if (!ctrl.signal.aborted) {
    sender.send('agent:done', chatId);
  }
});

// ─── KODA helpers ────────────────────────────────────────────────────────────

function kodaAgentIcon(agent: string): string {
  if (agent === 'code')   return '⚡';
  if (agent === 'review') return '🔍';
  if (agent === 'git')    return '🌿';
  return '•';
}

const STEP_FINDINGS_FOOTER = `

## SAÍDA OBRIGATÓRIA — escreva sempre ao finalizar:

## Achados
- **Arquivo(s):** <caminho(s) exato(s) ou "nenhum">
- **Ação:** <o que foi feito em 1 linha>
- **Resultado:** <sucesso | falha | pendente> — <motivo se falha>

Este bloco é mandatório: é passado como contexto ao próximo agente para que não re-pesquise.`;

function kodaStepSystemPrompt(agentType: string): string {
  const roles: Record<string, string> = {
    code: `Você é um engenheiro de software sênior. Execute a tarefa EXATAMENTE como descrita — nem mais, nem menos.
Regras: leia o arquivo antes de editar; use search_files para localizar código desconhecido; não execute builds ou testes a menos que explicitamente pedido; não abra arquivos desnecessários.
Responda em português do Brasil.${STEP_FINDINGS_FOOTER}`,

    review: `Você é um revisor de código sênior. Analise o código solicitado e produza uma revisão estruturada com: problemas encontrados (cite linha com [Lxxx]), sugestões de melhoria, e veredicto geral (APROVADO / REQUER ATENÇÃO / CRÍTICO).
Seja direto e objetivo — sem elogios vazios. Responda em português do Brasil.${STEP_FINDINGS_FOOTER}`,

    git: `Você é um especialista em git. Execute APENAS a operação git solicitada usando bash.
Não edite arquivos de código. Não execute builds. Apenas git.
Responda em português do Brasil.${STEP_FINDINGS_FOOTER}`,
  };
  return roles[agentType] ?? `Você é um assistente especialista. Execute a tarefa exatamente como pedido. Responda em português do Brasil.${STEP_FINDINGS_FOOTER}`;
}

// Per-tool scope rule: tells the agent EXACTLY what to do and WHEN to stop.
// This prevents step 1 from doing the work of steps 2-4.
const TOOL_SCOPE: Record<string, string> = {
  ask:         'ESCOPO: pesquise e descreva o que encontrou. NÃO edite arquivos. NÃO resolva problemas. Escreva ## Achados e pare.',
  explain_file:'ESCOPO: leia e explique ESTE arquivo. Não edite, não execute, não analise outros arquivos. Escreva ## Achados e pare.',
  review_file: 'ESCOPO: revise ESTE arquivo. Não edite, não execute. Liste problemas com [Lxxx], sugestões, veredicto. Escreva ## Achados e pare.',
  run_command: 'ESCOPO: execute ESTE comando e reporte o output exato. Não edite arquivos. Não tente corrigir erros encontrados. Escreva ## Achados e pare.',
  edit_file:   'ESCOPO: edite APENAS o arquivo especificado conforme a instrução. Não execute builds nem edite outros arquivos. Escreva ## Achados e pare.',
  run_task:    'ESCOPO: execute a tarefa de codificação. Crie/edite os arquivos necessários. Ao terminar escreva ## Achados com arquivos modificados e pare — não execute builds ou testes.',
  commit:      'ESCOPO: faça apenas o commit (git add + git commit). Escreva ## Achados e pare.',
};

function maxTurnsForTool(tool: string): number {
  const map: Record<string, number> = {
    ask: 6, explain_file: 6, review_file: 6,
    run_command: 4, edit_file: 6, commit: 3,
    run_task: 15,
  };
  return map[tool] ?? 8;
}

function kodaStepMessage(
  step: { tool: string; args: Record<string, unknown>; description: string },
  accumulatedContext?: string,
): string {
  const lines = [step.description];
  if (step.args.file)        lines.push(`\nArquivo: ${step.args.file}`);
  if (step.args.instruction) lines.push(`Instrução: ${step.args.instruction}`);
  if (step.args.query)       lines.push(`Consulta: ${step.args.query}`);
  if (step.args.task)        lines.push(`Tarefa: ${step.args.task}`);
  if (step.args.command)     lines.push(`Comando: ${step.args.command}`);
  if (accumulatedContext) {
    lines.push(`\n--- Contexto dos passos anteriores (use para não re-pesquisar) ---\n${accumulatedContext}`);
  }
  const scope = TOOL_SCOPE[step.tool];
  if (scope) lines.push(`\n${scope}`);
  return lines.join('\n');
}

// ─── KODA model routing ───────────────────────────────────────────────────────

interface StepConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  systemPrompt: string;
}

function resolveStepConfig(
  agentType: string,
  settings: any,
  globalApiKey: string,
  globalBaseUrl: string,
  globalModel: string,
): StepConfig {
  const systemPrompt = kodaStepSystemPrompt(agentType);

  // 1) Manual routing: settings.kodaRouting[agentType]
  const routing = settings?.kodaRouting?.[agentType] as { providerId: string; model: string } | undefined;
  if (routing?.providerId && routing?.model) {
    const provider = (settings?.providers as any[] | undefined)?.find((p: any) => p.id === routing.providerId && p.enabled);
    if (provider?.apiKey) {
      return { apiKey: provider.apiKey, baseUrl: provider.baseUrl ?? '', model: routing.model, systemPrompt };
    }
  }

  // 2) Skill-based: find a configured agent whose skills match the step type
  const skillMap: Record<string, string[]> = {
    code:   ['code', 'edit', 'implementation', 'software-engineer', 'refactoring', 'debugging', 'engineering'],
    review: ['review', 'code-review', 'security', 'audit', 'quality'],
    git:    ['git', 'version-control', 'devops'],
  };
  const targetSkills = skillMap[agentType] ?? [];
  const matchingAgent = (settings?.agents as any[] | undefined)?.find((a: any) => {
    if (!a.model) return false;
    const agentSkills: string[] = (a.skills ?? '').split(',').map((s: string) => s.trim().toLowerCase());
    return targetSkills.some(ts => agentSkills.includes(ts));
  });
  if (matchingAgent?.model) {
    const modelId = matchingAgent.model as string;
    const sp = matchingAgent.systemPrompt?.trim() ? matchingAgent.systemPrompt : systemPrompt;
    // Try to find a provider that owns this model for a matching apiKey/baseUrl
    const provider = (settings?.providers as any[] | undefined)?.find((p: any) =>
      p.enabled && p.apiKey && p.models.split(',').map((m: string) => m.trim()).includes(modelId)
    );
    // Use the provider's credentials if found; otherwise fall back to global (CEO) credentials
    // This ensures the agent's model and system prompt are always honoured
    return {
      apiKey:  provider?.apiKey  ?? globalApiKey,
      baseUrl: provider?.baseUrl ?? globalBaseUrl,
      model:   modelId,
      systemPrompt: sp,
    };
  }

  // 3) Global fallback
  return { apiKey: globalApiKey, baseUrl: globalBaseUrl, model: globalModel, systemPrompt };
}

// ─── IPC: KODA CEO ───────────────────────────────────────────────────────────

const kodaControllers = new Map<string, AbortController>();

ipcMain.handle('koda:spokenSummary', async (_, {
  task, steps, kodaWorkspace,
}: { task: string; steps: Array<{ step: { description: string }; result?: string; error?: string }>; kodaWorkspace?: any }) => {
  try {
    const { createProvider } = await import('../src/llm/provider.js');
    const { config } = await import('../src/config.js');

    let provider;
    if (kodaWorkspace) {
      provider = createProvider({
        apiKey:    kodaWorkspace.ceo.apiKey,
        baseURL:   kodaWorkspace.ceo.baseURL ?? config.baseURL,
        model:     kodaWorkspace.ceo.model,
        maxTokens: 220,
      });
    } else {
      if (!config.apiKey) return null;
      provider = createProvider({ ...config, maxTokens: 220 });
    }

    const allOk  = steps.every(s => !s.error);
    const failed = steps.filter(s => s.error).map(s => s.step.description).join(', ');
    const done   = steps.filter(s => !s.error).map(s => s.step.description).join(', ');

    const system = 'Você é KODA. Gere resumos de tarefas em português do Brasil, curtos e diretos para leitura em voz alta. Sem formatação, sem markdown, sem listas.';
    const user   = `Tarefa: "${task}"
Resultado: ${allOk ? 'sucesso' : `falha em — ${failed}`}
O que foi feito: ${done || 'nada concluído'}

Gere exatamente 2 frases curtas e naturais resumindo o resultado. Sem markdown, sem listas. Apenas texto corrido.`;

    const res = await provider.complete({
      messages: [
        { role: 'system', content: system },
        { role: 'user',   content: user },
      ],
    });

    return res.content?.trim() || null;
  } catch {
    return null;
  }
});

ipcMain.handle('koda:getConfig', async () => {
  const { loadAppConfig } = await import('../src/app/config.js');
  return loadAppConfig();
});

ipcMain.handle('koda:saveConfig', async (_, config: unknown) => {
  const { saveAppConfig } = await import('../src/app/config.js');
  saveAppConfig(config as any);
  return { ok: true };
});

ipcMain.handle('koda:plan', async (_, {
  projectRoot, task, kodaWorkspace,
}: { projectRoot: string; task: string; kodaWorkspace?: any }) => {
  try {
    const { generatePlan } = await import('../src/ceo/planner.js');
    const { createProvider } = await import('../src/llm/provider.js');
    const { config } = await import('../src/config.js');

    let provider;
    if (kodaWorkspace) {
      provider = createProvider({
        apiKey:    kodaWorkspace.ceo.apiKey,
        baseURL:   kodaWorkspace.ceo.baseURL ?? config.baseURL,
        model:     kodaWorkspace.ceo.model,
        maxTokens: kodaWorkspace.ceo.maxTokens ?? config.maxTokens,
      });
    } else {
      if (!config.apiKey) return { error: 'API key not configured. Run `ai setup` first.' };
      provider = createProvider(config);
    }

    const plan = await generatePlan(provider, task, projectRoot);
    if (!plan || plan.steps.length === 0) return { error: 'Could not generate a plan. Try rephrasing the task.' };
    return { plan };
  } catch (e) {
    return { error: (e as Error).message };
  }
});

ipcMain.on('koda:run', async (event, {
  workspaceId, projectRoot, kodaWorkspace, plan, settings,
}: { workspaceId: string; projectRoot: string; task?: string; kodaWorkspace?: any; plan?: any; settings?: any }) => {
  const sender = event.sender;
  kodaControllers.get(workspaceId)?.abort();
  const ctrl = new AbortController();
  kodaControllers.set(workspaceId, ctrl);

  try {
    const { config } = await import('../src/config.js');

    let apiKey: string;
    let baseUrl: string;
    let model: string;

    if (kodaWorkspace) {
      apiKey  = kodaWorkspace.ceo.apiKey;
      baseUrl = kodaWorkspace.ceo.baseURL ?? '';
      model   = kodaWorkspace.ceo.model;
    } else {
      if (!config.apiKey) {
        sender.send('koda:done', { workspaceId, error: 'API key not configured. Run `ai setup` first.' });
        kodaControllers.delete(workspaceId);
        return;
      }
      apiKey  = config.apiKey;
      baseUrl = config.baseURL ?? '';
      model   = config.model;
    }

    // Emit plan so the KODA panel can still show the plan overview
    if (!ctrl.signal.aborted) sender.send('koda:progress', { workspaceId, event: { type: 'plan', plan } });

    // Create a stable chatId per step and tell the renderer to open chat sessions
    const ts = Date.now();
    const chatIds: string[] = plan.steps.map((_: any, i: number) => `koda-${workspaceId}-${ts}-${i}`);

    sender.send('koda:chats', {
      workspaceId,
      chats: plan.steps.map((step: any, i: number) => {
        const cfg = resolveStepConfig(step.agent, settings, apiKey, baseUrl, model);
        return {
          chatId: chatIds[i],
          title:  `${kodaAgentIcon(step.agent)} ${step.description.slice(0, 60)}`,
          model:  cfg.model,
        };
      }),
    });

    const stepResults: Array<{ step: any; result: string; error?: string }> = [];

    // Compact context from completed steps to pass to the next one
    const buildAccumulatedContext = (upToIndex: number): string => {
      const parts: string[] = [];
      for (let j = 0; j < upToIndex; j++) {
        const r = stepResults[j];
        if (!r || r.error) continue;
        const snippet = r.result.length > 600 ? '…' + r.result.slice(-600).trimStart() : r.result;
        parts.push(`=== Passo ${j + 1}: [${r.step.agent}] ${r.step.description} ===\n${snippet}`);
      }
      return parts.join('\n\n');
    };

    const executeStep = async (step: any, i: number): Promise<void> => {
      if (ctrl.signal.aborted) return;

      const chatId = chatIds[i];
      const cfg = resolveStepConfig(step.agent, settings, apiKey, baseUrl, model);
      sender.send('koda:progress', {
        workspaceId,
        event: { type: 'step_start', step, index: i, total: plan.steps.length, chatId, resolvedModel: cfg.model },
      });

      try {
        const context = plan.parallel ? undefined : buildAccumulatedContext(i) || undefined;
        const message = kodaStepMessage(step, context);
        const isAnthropicModel = cfg.model.startsWith('claude') || cfg.baseUrl.includes('anthropic');

        // Resolve short-lived / OAuth tokens before each step
        let stepApiKey = cfg.apiKey;
        let stepUseOAuth = false;
        if (cfg.apiKey === 'copilot-oauth') {
          const { getValidCopilotToken } = await import('./copilot-auth.js');
          stepApiKey = (await getValidCopilotToken()) ?? cfg.apiKey;
        } else if (cfg.apiKey === 'claude-code-oauth') {
          const { getValidToken } = await import('./claude-code-auth.js');
          stepApiKey = (await getValidToken()) ?? cfg.apiKey;
          stepUseOAuth = true;
        }

        // Use real agentic runner with file system tools instead of dumb completion
        const turns = maxTurnsForTool(step.tool);
        const result = (isAnthropicModel || stepUseOAuth)
          ? await runAnthropicAgentic(sender, chatId, projectRoot, message, stepApiKey, cfg.model, ctrl.signal, cfg.systemPrompt, turns, stepUseOAuth)
          : await runOpenAIAgentic(sender, chatId, projectRoot, message, stepApiKey, cfg.baseUrl, cfg.model, ctrl.signal, cfg.systemPrompt, turns);

        stepResults[i] = { step, result };
        sender.send('agent:done', chatId);
        if (!ctrl.signal.aborted) {
          sender.send('koda:progress', { workspaceId, event: { type: 'step_done', step, index: i, result } });
        }
      } catch (err: any) {
        const error = String(err?.message ?? err);
        stepResults[i] = { step, result: '', error };
        sender.send('agent:done', chatId);
        if (!ctrl.signal.aborted && err?.name !== 'AbortError') {
          sender.send('koda:progress', { workspaceId, event: { type: 'step_error', step, index: i, error } });
        }
      }
    };

    if (plan.parallel) {
      await Promise.all(plan.steps.map((step: any, i: number) => executeStep(step, i)));
    } else {
      for (const [i, step] of plan.steps.entries()) {
        await executeStep(step, i);
        if (ctrl.signal.aborted) break;
      }
    }

    if (!ctrl.signal.aborted) {
      const summaryLines: string[] = [];
      for (const [i, r] of stepResults.entries()) {
        if (!r) continue;
        summaryLines.push(`${r.error ? '✕' : '✓'} Passo ${i + 1} — [${r.step.agent}] ${r.step.description}`);
        if (r.error) {
          summaryLines.push(`  ⚠ ${r.error}`);
        } else if (r.result) {
          const tail = r.result.length > 600 ? '…' + r.result.slice(-600).trimStart() : r.result;
          summaryLines.push(tail.split('\n').map((l: string) => `  ${l}`).join('\n'));
        }
        summaryLines.push('');
      }
      const summary = summaryLines.join('\n').trimEnd();
      sender.send('koda:progress', { workspaceId, event: { type: 'done', summary } });
    }
  } catch (e: any) {
    if (e?.name !== 'AbortError' && e?.code !== 'ERR_CANCELED') {
      sender.send('koda:progress', {
        workspaceId,
        event: { type: 'done', summary: `Error: ${(e as Error).message}` },
      });
    }
  }

  if (!ctrl.signal.aborted) sender.send('koda:done', { workspaceId });
  kodaControllers.delete(workspaceId);
});

ipcMain.handle('koda:stop', (_, workspaceId: string) => {
  kodaControllers.get(workspaceId)?.abort();
  kodaControllers.delete(workspaceId);
  return { ok: true };
});

ipcMain.handle('koda:tts', async (_, {
  text, config: ttsCfg,
}: { text: string; config: { apiKey: string; voice: string; model: string; speed: number } }) => {
  try {
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({ apiKey: ttsCfg.apiKey });
    const response = await client.audio.speech.create({
      model: ttsCfg.model as any,
      voice: ttsCfg.voice as any,
      input: text,
      speed: ttsCfg.speed ?? 1.0,
    });
    const buffer = Buffer.from(await response.arrayBuffer());
    return { data: buffer.toString('base64') };
  } catch (e) {
    return { error: (e as Error).message };
  }
});

ipcMain.handle('koda:stt', async (_, { audioData }: { audioData: string }) => {
  try {
    const { loadAppConfig } = await import('../src/app/config.js');
    const cfg = loadAppConfig();
    if (!cfg.stt.apiKey) return { error: 'STT API key not configured in KODA settings.' };
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({ apiKey: cfg.stt.apiKey });
    const buffer = Buffer.from(audioData, 'base64');
    const file = new File([buffer], 'audio.webm', { type: 'audio/webm' });
    const transcription = await client.audio.transcriptions.create({ model: 'whisper-1', file, language: 'pt' });
    return { text: transcription.text };
  } catch (e) {
    return { error: (e as Error).message };
  }
});

ipcMain.handle('koda:listWorkspaces', async () => {
  try {
    const { listWorkspaces, loadWorkspace, getActive } = await import('../src/workspace/store.js');
    const active = getActive();
    return listWorkspaces().map(name => ({
      name,
      workspace: loadWorkspace(name),
      isActive: name === active,
    }));
  } catch { return []; }
});

// ─── helpers ──────────────────────────────────────────────────────────────────

ipcMain.handle('fs:rename', (_, { oldPath, newPath }: { oldPath: string; newPath: string }) => {
  try { fs.renameSync(oldPath, newPath); return { ok: true }; }
  catch (e) { return { error: (e as Error).message }; }
});

// ── file watcher ───────────────────────────────────────────────────────────────
const fileWatchers = new Map<string, fs.FSWatcher>();
const watchDebounce = new Map<string, ReturnType<typeof setTimeout>>();

ipcMain.handle('fs:watch', (event, root: string) => {
  if (fileWatchers.has(root)) return;
  try {
    const watcher = fs.watch(root, { recursive: true }, () => {
      const prev = watchDebounce.get(root);
      if (prev) clearTimeout(prev);
      watchDebounce.set(root, setTimeout(() => {
        watchDebounce.delete(root);
        event.sender.send('files:changed', root);
      }, 600));
    });
    fileWatchers.set(root, watcher);
  } catch { /* recursive watch not supported on this platform */ }
});

ipcMain.handle('fs:unwatch', (_, root: string) => {
  fileWatchers.get(root)?.close();
  fileWatchers.delete(root);
  const t = watchDebounce.get(root);
  if (t) { clearTimeout(t); watchDebounce.delete(root); }
});

interface FileNode { name: string; path: string; type: 'file' | 'dir'; children?: FileNode[] }
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '__pycache__', '.turbo', 'out']);

function readTree(dir: string, depth: number): FileNode[] {
  if (depth > 10) return [];
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => !SKIP.has(e.name))
      .sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1))
      .map(e => ({
        name: e.name,
        path: path.join(dir, e.name),
        type: (e.isDirectory() ? 'dir' : 'file') as 'file' | 'dir',
        children: e.isDirectory() ? readTree(path.join(dir, e.name), depth + 1) : undefined,
      }));
  } catch { return []; }
}

// ─── IPC: Claude Code account ─────────────────────────────────────────────────

ipcMain.handle('claudecode:auth:status', async () => {
  const { getStatus } = await import('./claude-code-auth.js');
  return getStatus();
});

ipcMain.handle('claudecode:token:get', async () => {
  const { getValidToken } = await import('./claude-code-auth.js');
  return getValidToken();
});

// ─── IPC: GitHub Copilot OAuth ────────────────────────────────────────────────

ipcMain.handle('copilot:auth:start', async (_, clientId?: string) => {
  const { startDeviceFlow, DEFAULT_CLIENT_ID } = await import('./copilot-auth.js');
  return startDeviceFlow(clientId ?? DEFAULT_CLIENT_ID);
});

ipcMain.handle('copilot:auth:poll', async (_, { deviceCode, clientId }: { deviceCode: string; clientId?: string }) => {
  const { pollForGithubToken, completeAuth, DEFAULT_CLIENT_ID } = await import('./copilot-auth.js');
  const result = await pollForGithubToken(clientId ?? DEFAULT_CLIENT_ID, deviceCode);
  if (result === 'pending' || result === 'expired') return { status: result };
  // Got a GitHub token — exchange it for Copilot token and persist
  const authStatus = await completeAuth(result);
  return { status: 'complete', ...authStatus };
});

ipcMain.handle('copilot:auth:status', async () => {
  const { getAuthStatus } = await import('./copilot-auth.js');
  return getAuthStatus();
});

ipcMain.handle('copilot:auth:logout', async () => {
  const { clearAuth } = await import('./copilot-auth.js');
  clearAuth();
  return { ok: true };
});

ipcMain.handle('copilot:token:get', async () => {
  const { getValidCopilotToken } = await import('./copilot-auth.js');
  return getValidCopilotToken();
});
