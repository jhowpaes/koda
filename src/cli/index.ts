import { Command } from 'commander';
import readline from 'readline';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
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

// lazy init — setup command runs without API key
let _agent: Agent | null = null;
function getAgent(): Agent {
  if (!_agent) {
    if (!config.apiKey) {
      console.error(chalk.red('\nAPI key not set. Run `ai setup` to configure.\n'));
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

const program = new Command();

program
  .name('ai')
  .description('CLI AI Agent for codebases')
  .version('0.2.0');

// ─── setup ────────────────────────────────────────────────────────────────────

program
  .command('setup')
  .description('Configure API key and default settings')
  .action(async () => {
    const configDir = path.join(os.homedir(), '.koda');
    const configFile = path.join(configDir, '.env');
    fs.mkdirSync(configDir, { recursive: true });

    console.log(chalk.bold.cyan('\nAI Setup\n'));

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
      chalk.cyan(`Base URL [${existing.LLM_BASE_URL ?? 'https://api.z.ai/api/coding/paas/v4'}]: `)
    );
    const model = await promptUser(
      chalk.cyan(`Model [${existing.LLM_MODEL ?? 'glm-5.1'}]: `)
    );

    const lines = [
      `LLM_API_KEY=${apiKey || (existing.LLM_API_KEY ?? '')}`,
      `LLM_BASE_URL=${baseURL || (existing.LLM_BASE_URL ?? 'https://api.z.ai/api/coding/paas/v4')}`,
      `LLM_MODEL=${model || (existing.LLM_MODEL ?? 'glm-5.1')}`,
      `LLM_MAX_TOKENS=4096`,
      `CONTEXT_BUDGET=12000`,
    ];

    fs.writeFileSync(configFile, lines.join('\n') + '\n');
    console.log(chalk.green(`\n✓ Saved to ${configFile}`));
    console.log(chalk.dim('Run `ai chat` to get started.\n'));
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

// ─── chat helpers ─────────────────────────────────────────────────────────────

// Detects @src/foo/bar.ts references, reads each file and appends content to message.
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

// Runs a shell command and returns { success, output } — never throws.
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

    console.log(chalk.bold.cyan('\nAI Chat'));
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

        // /run <cmd> — executes a shell command and sends output to the LLM
        if (msg.startsWith('/run ')) {
          const cmd = msg.slice(5).trim();
          if (!cmd) { loop(); return; }
          console.log(chalk.dim(`\n$ ${cmd}\n`));
          const { success, output } = runShellCommand(cmd);
          const icon = success ? chalk.green('✓') : chalk.red('✕');
          console.log(`${icon} ${output || '(no output)'}\n`);
          const context = `I ran \`${cmd}\`.\n\n${success ? 'Output' : 'Error'}:\n${output}`;
          process.stdout.write(chalk.bold('ai › '));
          await agent.chat(context);
          process.stdout.write('\n');
          loop(); return;
        }

        // @file references — inject file content into the message before sending
        const { content, injected } = injectFileRefs(msg);
        if (injected.length > 0) {
          console.log(chalk.dim(`  Attached: ${injected.join(', ')}\n`));
        }

        process.stdout.write(chalk.bold('\nai › '));
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
