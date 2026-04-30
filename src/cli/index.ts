import { Command } from 'commander';
import readline from 'readline';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync, spawnSync } from 'child_process';
import { config } from '../config.js';
import { createProvider } from '../llm/provider.js';
import { Agent } from '../core/agent.js';
import { extractCodeBlock, applyEdit } from '../actions/editor.js';
import { reviewFile } from '../commands/review.js';
import { explainFile } from '../commands/explain.js';
import { generateCommit } from '../commands/commit.js';
import { runTask } from '../commands/run.js';
import { clearSession } from '../core/session-store.js';
import { projectRoot } from '../utils/git.js';
import { CeoAgent } from '../ceo/agent.js';
import type { ProgressEvent } from '../ceo/types.js';
import {
  listWorkspaces,
  loadWorkspace,
  getActive,
  getActiveWorkspace,
  setActive,
  deleteWorkspace,
} from '../workspace/store.js';
import { createWorkspaceInteractive } from '../workspace/setup.js';

// ─── Agent (lazy init) ────────────────────────────────────────────────────────

let _agent: Agent | null = null;
function getAgent(): Agent {
  if (!_agent) {
    if (!config.apiKey) {
      console.error(chalk.red('\nAPI key not set. Run `koda setup` to configure.\n'));
      process.exit(1);
    }
    _agent = new Agent(createProvider(config), config.model);
  }
  return _agent;
}

function showProject() {
  const root = projectRoot();
  const display = root.startsWith(os.homedir()) ? root.replace(os.homedir(), '~') : root;
  process.stderr.write(chalk.dim(`  project: ${display}\n\n`));
}

// ─── CEO progress renderer ────────────────────────────────────────────────────

function renderProgress(event: ProgressEvent): void {
  switch (event.type) {
    case 'plan': {
      const complexityColor: Record<string, (s: string) => string> = {
        simple:   chalk.green,
        moderate: chalk.yellow,
        complex:  chalk.red,
      };
      const cx = event.plan.complexity ?? 'moderate';
      const colorFn = complexityColor[cx] ?? chalk.white;
      console.log(chalk.bold.cyan('\nKODA Plan') + chalk.dim(` [${colorFn(cx)}]\n`));
      if (event.plan.thinking) {
        console.log(chalk.dim(`  ${event.plan.thinking}\n`));
      }
      event.plan.steps.forEach((s, i) => {
        const tag = event.plan.parallel ? chalk.dim(' ∥') : '';
        console.log(`  ${i + 1}. ${chalk.cyan(`[${s.agent}]`)} ${chalk.bold(s.tool)}${tag}`);
        console.log(chalk.dim(`     ${s.description}`));
      });
      console.log();
      break;
    }
    case 'step_start':
      process.stdout.write(
        chalk.dim(`[${event.index + 1}/${event.total}] `) +
        chalk.cyan(`${event.step.agent} → ${event.step.tool}`) +
        chalk.dim(` — ${event.step.description}`) + '\n'
      );
      break;
    case 'step_done':
      console.log(chalk.green('  ✓ Done'));
      if (event.result && event.result.length < 400) {
        console.log(chalk.dim(event.result.split('\n').map(l => `     ${l}`).join('\n')));
      }
      console.log();
      break;
    case 'step_error':
      console.log(chalk.red(`  ✕ Error: ${event.error}\n`));
      break;
    case 'done':
      console.log(chalk.bold.green('\n─── Summary ─────────────────────────────'));
      console.log(event.summary);
      console.log(chalk.bold.green('─────────────────────────────────────────\n'));
      break;
  }
}

// ─── Program ──────────────────────────────────────────────────────────────────

const program = new Command();

program
  .name('koda')
  .description('AI coding assistant — CLI, CEO agent and desktop app launcher')
  .version('0.2.0');

// ─── setup ────────────────────────────────────────────────────────────────────

program
  .command('setup')
  .description('Configure API key and default settings')
  .action(async () => {
    const configDir = path.join(os.homedir(), '.koda');
    const configFile = path.join(configDir, '.env');
    fs.mkdirSync(configDir, { recursive: true });

    console.log(chalk.bold.cyan('\nKoda Setup\n'));

    const existing = fs.existsSync(configFile)
      ? Object.fromEntries(
          fs.readFileSync(configFile, 'utf-8')
            .split('\n')
            .filter(l => l.includes('='))
            .map(l => l.split('=').map(s => s.trim()) as [string, string])
        )
      : {};

    const apiKey = await promptUser(
      chalk.cyan(`API Key${existing.LLM_API_KEY ? ` [current: ${existing.LLM_API_KEY.slice(0, 8)}...]` : ''}: `)
    );
    const baseURL = await promptUser(
      chalk.cyan(`Base URL [${existing.LLM_BASE_URL ?? 'https://api.openai.com/v1'}]: `)
    );
    const model = await promptUser(
      chalk.cyan(`Model [${existing.LLM_MODEL ?? 'gpt-4o'}]: `)
    );

    const lines = [
      `LLM_API_KEY=${apiKey || (existing.LLM_API_KEY ?? '')}`,
      `LLM_BASE_URL=${baseURL || (existing.LLM_BASE_URL ?? 'https://api.openai.com/v1')}`,
      `LLM_MODEL=${model || (existing.LLM_MODEL ?? 'gpt-4o')}`,
      `LLM_MAX_TOKENS=4096`,
      `CONTEXT_BUDGET=12000`,
    ];

    fs.writeFileSync(configFile, lines.join('\n') + '\n');
    console.log(chalk.green(`\n✓ Saved to ${configFile}`));
    console.log(chalk.dim('Run `koda chat` to get started.\n'));
  });

// ─── open ─────────────────────────────────────────────────────────────────────

program
  .command('open [path]')
  .description('Open the Koda desktop app in the given folder (defaults to current directory)')
  .action((p?: string) => {
    const target = path.resolve(p ?? '.');
    if (!fs.existsSync(target)) {
      console.error(chalk.red(`Path not found: ${target}`));
      process.exit(1);
    }
    // Try macOS app bundle first, fall back to generic open
    const result = spawnSync('open', ['-a', 'Koda', '--args', '--open-path', target], { stdio: 'inherit' });
    if (result.status !== 0) {
      console.error(chalk.red('\nCould not open Koda app. Make sure it is installed in /Applications.\n'));
      process.exit(1);
    }
  });

// ─── ask ──────────────────────────────────────────────────────────────────────

program
  .command('ask <question>')
  .description('Ask a question about the current codebase')
  .action(async (question: string) => {
    showProject();
    await getAgent().ask(question, config.contextBudget);
  });

// ─── edit ─────────────────────────────────────────────────────────────────────

program
  .command('edit <file>')
  .description('Edit a file with AI assistance')
  .option('-i, --instruction <instruction>', 'Edit instruction')
  .action(async (file: string, opts: { instruction?: string }) => {
    const filePath = path.resolve(file);
    if (!fs.existsSync(filePath)) {
      console.error(chalk.red(`File not found: ${file}`));
      process.exit(1);
    }
    const instruction = opts.instruction ?? await promptUser(chalk.cyan('What should I change? '));
    if (!instruction.trim()) process.exit(0);
    console.log(chalk.dim('\nAnalyzing...\n'));
    const response = await getAgent().edit(filePath, instruction);
    const newContent = extractCodeBlock(response);
    if (!newContent) {
      console.log(chalk.yellow('\nNo code block in response — nothing to apply.'));
      return;
    }
    await applyEdit(filePath, newContent);
  });

// ─── review ───────────────────────────────────────────────────────────────────

program
  .command('review <file>')
  .description('Code review a file')
  .action(async (file: string) => {
    const filePath = path.resolve(file);
    if (!fs.existsSync(filePath)) {
      console.error(chalk.red(`File not found: ${file}`));
      process.exit(1);
    }
    await reviewFile(getAgent(), filePath);
  });

// ─── explain ──────────────────────────────────────────────────────────────────

program
  .command('explain <file>')
  .description('Explain what a file does')
  .action(async (file: string) => {
    const filePath = path.resolve(file);
    if (!fs.existsSync(filePath)) {
      console.error(chalk.red(`File not found: ${file}`));
      process.exit(1);
    }
    await explainFile(getAgent(), filePath);
  });

// ─── commit ───────────────────────────────────────────────────────────────────

program
  .command('commit')
  .description('Generate a commit message from staged changes')
  .action(async () => {
    await generateCommit(getAgent());
  });

// ─── run ──────────────────────────────────────────────────────────────────────

program
  .command('run <task>')
  .description('Autonomous agent: plan and execute a task with confirmation')
  .action(async (task: string) => {
    showProject();
    await runTask(getAgent(), task);
  });

// ─── task (CEO multi-agent) ───────────────────────────────────────────────────

program
  .command('task <description...>')
  .description('Run a multi-step task using the CEO agent (orchestrates code/review/git agents)')
  .action(async (parts: string[]) => {
    const taskStr = parts.join(' ');
    const workspace = getActiveWorkspace() ?? undefined;

    let provider;
    if (workspace) {
      const { createProvider: cp } = await import('../llm/provider.js');
      provider = cp({
        provider:  workspace.ceo.provider,
        apiKey:    workspace.ceo.apiKey,
        baseURL:   workspace.ceo.baseURL ?? (workspace.ceo.provider === 'anthropic' ? undefined : config.baseURL),
        model:     workspace.ceo.model,
        maxTokens: workspace.ceo.maxTokens ?? config.maxTokens,
      });
    } else {
      if (!config.apiKey) {
        console.error(chalk.red('\nAPI key not set. Run `koda setup` or `koda workspace new`.\n'));
        process.exit(1);
      }
      provider = createProvider(config);
    }

    const activeName = getActive();
    console.log(chalk.bold.cyan('\nKODA\n'));
    if (activeName) console.log(chalk.dim(`Workspace: ${activeName}`));
    console.log(chalk.dim(`Task: ${taskStr}\n`));
    console.log(chalk.dim('Planning...\n'));

    const ceo = new CeoAgent(provider, workspace);
    try {
      await ceo.run(taskStr, { onProgress: renderProgress });
    } finally {
      await ceo.close();
    }
  });

// ─── workspace ────────────────────────────────────────────────────────────────

const ws = program
  .command('workspace')
  .alias('ws')
  .description('Manage workspaces');

ws.command('new')
  .alias('create')
  .description('Create a new workspace (interactive)')
  .action(async () => { await createWorkspaceInteractive(); });

ws.command('list')
  .alias('ls')
  .description('List all workspaces')
  .action(() => {
    const names = listWorkspaces();
    const active = getActive();
    if (names.length === 0) {
      console.log(chalk.dim('\nNo workspaces yet. Run: koda workspace new\n'));
      return;
    }
    console.log(chalk.bold('\nWorkspaces:\n'));
    for (const name of names) {
      const w = loadWorkspace(name);
      const isActive = name === active;
      const marker = isActive ? chalk.green('● ') : chalk.dim('  ');
      console.log(`${marker}${chalk.bold(name)}${isActive ? chalk.green(' (active)') : ''}`);
      if (w) {
        console.log(chalk.dim(`    root:  ${w.root}`));
        console.log(chalk.dim(`    model: ${w.ceo.model}`));
      }
    }
    console.log();
  });

ws.command('use <name>')
  .alias('switch')
  .description('Set active workspace')
  .action((name: string) => {
    setActive(name);
    console.log(chalk.green(`\n✓ Active workspace: ${name}\n`));
  });

ws.command('show')
  .alias('status')
  .description('Show active workspace details')
  .action(() => {
    const active = getActive();
    if (!active) {
      console.log(chalk.dim('\nNo active workspace. Run: koda workspace new\n'));
      return;
    }
    const w = loadWorkspace(active)!;
    console.log(chalk.bold('\nActive workspace:\n'));
    console.log(`  Name:     ${chalk.cyan(w.name)}`);
    console.log(`  Root:     ${w.root}`);
    console.log(`  Model:    ${w.ceo.model}`);
    console.log(`  Provider: ${w.ceo.provider}`);
    if (Object.keys(w.agents).length > 0) {
      console.log(`  Agent overrides:`);
      for (const [agent, cfg] of Object.entries(w.agents)) {
        if (cfg) console.log(`    ${agent}: ${cfg.model ?? 'inherited'}`);
      }
    }
    console.log();
  });

ws.command('delete <name>')
  .alias('rm')
  .description('Delete a workspace')
  .action((name: string) => {
    deleteWorkspace(name);
    console.log(chalk.green(`\n✓ Workspace "${name}" deleted.\n`));
  });

// ─── chat helpers ─────────────────────────────────────────────────────────────

function injectFileRefs(msg: string): { content: string; injected: string[] } {
  const injected: string[] = [];
  const appended: string[] = [];

  const content = msg.replace(/@([\w.\-/]+\.\w+)/g, (match, ref) => {
    const filePath = path.resolve(projectRoot(), ref);
    if (!fs.existsSync(filePath)) return match;
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const ext = path.extname(ref).slice(1);
    injected.push(ref);
    appended.push(`### ${ref}\n\`\`\`${ext}\n${fileContent.slice(0, 6000)}\n\`\`\``);
    return match;
  });

  return {
    content: appended.length ? `${content}\n\n${appended.join('\n\n')}` : content,
    injected,
  };
}

function runShellCommand(cmd: string): { success: boolean; output: string } {
  try {
    const output = execSync(cmd, {
      cwd: projectRoot(),
      encoding: 'utf-8',
      timeout: 60000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { success: true, output: output.trim() };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string };
    const output = [e.stdout, e.stderr].filter(Boolean).join('\n').trim();
    return { success: false, output: output || String(err) };
  }
}

// ─── chat ─────────────────────────────────────────────────────────────────────

program
  .command('chat')
  .description('Interactive chat with memory of the current project')
  .option('--new', 'Start a new session (clears history)')
  .action(async (opts: { new?: boolean }) => {
    const agent = getAgent();

    if (opts.new) {
      clearSession(projectRoot());
      agent.clearHistory();
    }

    const histLen = agent.getHistory().length;

    console.log(chalk.bold.cyan('\nKoda Chat'));
    showProject();
    if (histLen > 0) console.log(chalk.dim(`Resuming session (${histLen / 2} previous turns)`));
    console.log(chalk.dim('Commands: /clear  /model <name>  /context  /history  /run <cmd>  /exit'));
    console.log(chalk.dim('Tips:     @src/foo.ts  to attach a file\n'));

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    const loop = () => {
      rl.question(chalk.cyan('you › '), async input => {
        const msg = input.trim();
        if (!msg) { loop(); return; }

        if (msg === '/exit' || msg === '/quit') { rl.close(); return; }

        if (msg === '/clear') {
          agent.clearHistory();
          console.log(chalk.dim('Session cleared.\n'));
          loop(); return;
        }

        if (msg === '/history') {
          console.log(chalk.dim(`${agent.getHistory().length / 2} turns in session.\n`));
          loop(); return;
        }

        if (msg === '/context') {
          const { loadProjectContext } = await import('../context/project.js');
          const ctx = loadProjectContext();
          console.log(chalk.dim(ctx || 'No .aicontext found.\n'));
          loop(); return;
        }

        if (msg.startsWith('/model ')) {
          const m = msg.slice(7).trim();
          if (m) { agent.setModel(m); console.log(chalk.dim(`Model: ${m}\n`)); }
          loop(); return;
        }

        if (msg.startsWith('/run ')) {
          const cmd = msg.slice(5).trim();
          if (!cmd) { loop(); return; }
          console.log(chalk.dim(`\n$ ${cmd}\n`));
          const { success, output } = runShellCommand(cmd);
          const icon = success ? chalk.green('✓') : chalk.red('✕');
          console.log(`${icon} ${output || '(no output)'}\n`);
          const context = `I ran \`${cmd}\`.\n\n${success ? 'Output' : 'Error'}:\n${output}`;
          process.stdout.write(chalk.bold('koda › '));
          await agent.chat(context);
          process.stdout.write('\n');
          loop(); return;
        }

        const { content, injected } = injectFileRefs(msg);
        if (injected.length > 0) {
          console.log(chalk.dim(`  Attached: ${injected.join(', ')}\n`));
        }

        process.stdout.write(chalk.bold('\nkoda › '));
        await agent.chat(content);
        process.stdout.write('\n');
        loop();
      });
    };

    loop();
    rl.on('close', () => { console.log(chalk.dim('\nBye.')); process.exit(0); });
  });

program.parse();

function promptUser(prompt: string): Promise<string> {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, answer => { rl.close(); resolve(answer); });
  });
}
