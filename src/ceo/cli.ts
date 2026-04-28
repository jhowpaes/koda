import chalk from 'chalk';
import { config } from '../config.js';
import { createProvider } from '../llm/provider.js';
import { CeoAgent } from './agent.js';
import type { ProgressEvent } from './types.js';
import {
  listWorkspaces,
  loadWorkspace,
  getActive,
  getActiveWorkspace,
  setActive,
  deleteWorkspace,
} from '../workspace/store.js';
import { createWorkspaceInteractive } from '../workspace/setup.js';

// ─── Workspace subcommands ────────────────────────────────────────────────────

async function cmdWorkspace(args: string[]): Promise<void> {
  const sub = args[0];

  switch (sub) {
    case 'new':
    case 'create': {
      await createWorkspaceInteractive();
      break;
    }

    case 'list':
    case 'ls': {
      const names = listWorkspaces();
      const active = getActive();
      if (names.length === 0) {
        console.log(chalk.dim('\nNo workspaces yet. Run: koda workspace new\n'));
        return;
      }
      console.log(chalk.bold('\nWorkspaces:\n'));
      for (const name of names) {
        const ws = loadWorkspace(name);
        const isActive = name === active;
        const marker = isActive ? chalk.green('● ') : chalk.dim('  ');
        console.log(`${marker}${chalk.bold(name)}${isActive ? chalk.green(' (active)') : ''}`);
        if (ws) {
          console.log(chalk.dim(`    root:  ${ws.root}`));
          console.log(chalk.dim(`    model: ${ws.ceo.model}`));
        }
      }
      console.log();
      break;
    }

    case 'use':
    case 'switch': {
      const name = args[1];
      if (!name) { console.error(chalk.red('Usage: koda workspace use <name>')); process.exit(1); }
      setActive(name);
      console.log(chalk.green(`\n✓ Active workspace: ${name}\n`));
      break;
    }

    case 'show':
    case 'status': {
      const active = getActive();
      if (!active) {
        console.log(chalk.dim('\nNo active workspace. Run: koda workspace new\n'));
        return;
      }
      const ws = loadWorkspace(active)!;
      console.log(chalk.bold('\nActive workspace:\n'));
      console.log(`  Name:     ${chalk.cyan(ws.name)}`);
      console.log(`  Root:     ${ws.root}`);
      console.log(`  Model:    ${ws.ceo.model}`);
      console.log(`  Provider: ${ws.ceo.provider}`);
      if (Object.keys(ws.agents).length > 0) {
        console.log(`  Agent overrides:`);
        for (const [agent, cfg] of Object.entries(ws.agents)) {
          if (cfg) console.log(`    ${agent}: ${cfg.model ?? 'inherited'}`);
        }
      }
      console.log();
      break;
    }

    case 'delete':
    case 'rm': {
      const name = args[1];
      if (!name) { console.error(chalk.red('Usage: koda workspace delete <name>')); process.exit(1); }
      deleteWorkspace(name);
      console.log(chalk.green(`\n✓ Workspace "${name}" deleted.\n`));
      break;
    }

    default: {
      console.log(chalk.bold('\nkoda workspace <subcommand>\n'));
      console.log('  new          Create a new workspace (interactive)');
      console.log('  list         List all workspaces');
      console.log('  use <name>   Set active workspace');
      console.log('  show         Show active workspace details');
      console.log('  delete <n>   Delete a workspace');
      console.log();
      break;
    }
  }
}

// ─── Progress renderer ────────────────────────────────────────────────────────

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

// ─── Main ─────────────────────────────────────────────────────────────────────

const [,, first, ...rest] = process.argv;

if (!first || first === '--help' || first === '-h') {
  console.log(chalk.bold('\nkoda <task>                    Run a task with the CEO Agent'));
  console.log(chalk.bold('koda workspace <subcommand>    Manage workspaces'));
  console.log(chalk.dim('\nExamples:'));
  console.log(chalk.dim('  koda "review src/auth.ts and commit the changes"'));
  console.log(chalk.dim('  koda workspace new'));
  console.log(chalk.dim('  koda workspace list'));
  console.log();
  process.exit(0);
}

if (first === 'workspace') {
  await cmdWorkspace(rest);
  process.exit(0);
}

// ─── Run CEO task ─────────────────────────────────────────────────────────────

const task = [first, ...rest].join(' ').trim();
const workspace = getActiveWorkspace() ?? undefined;

// Build LLM provider: prefer workspace CEO config, fall back to global config
let provider;
if (workspace) {
  const { createProvider: cp } = await import('../llm/provider.js');
  provider = cp({
    apiKey:    workspace.ceo.apiKey,
    baseURL:   workspace.ceo.baseURL ?? config.baseURL,
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
console.log(chalk.dim(`Task: ${task}\n`));
console.log(chalk.dim('Planning...\n'));

const ceo = new CeoAgent(provider, workspace);

try {
  await ceo.run(task, { onProgress: renderProgress });
} finally {
  await ceo.close();
}
