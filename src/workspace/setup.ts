import readline from 'readline';
import fs from 'fs';
import os from 'os';
import path from 'path';
import chalk from 'chalk';
import type { WorkspaceConfig } from './types.js';
import { saveWorkspace, setActive } from './store.js';

function ask(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise(resolve => rl.question(prompt, resolve));
}

export async function createWorkspaceInteractive(): Promise<WorkspaceConfig> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log(chalk.bold.cyan('\nKODA — New Workspace\n'));

  const name = (await ask(rl, chalk.cyan('Workspace name: '))).trim();
  if (!name) { rl.close(); throw new Error('Name is required.'); }

  const defaultRoot = process.cwd();
  const rootInput = (await ask(rl, chalk.cyan(`Project root [${defaultRoot}]: `))).trim();
  const root = rootInput || defaultRoot;

  if (!fs.existsSync(root)) { rl.close(); throw new Error(`Path not found: ${root}`); }

  console.log(chalk.dim('\nCEO Agent LLM config:\n'));

  const defaultBaseURL = 'https://api.z.ai/api/coding/paas/v4';
  const defaultModel   = 'glm-5.1';

  const apiKey  = (await ask(rl, chalk.cyan('API Key: '))).trim();
  const baseURL = (await ask(rl, chalk.cyan(`Base URL [${defaultBaseURL}]: `))).trim() || defaultBaseURL;
  const model   = (await ask(rl, chalk.cyan(`Model [${defaultModel}]: `))).trim() || defaultModel;

  const sameForAll = (await ask(rl, chalk.cyan('\nUse same LLM for all agents? [Y/n]: ')))
    .trim().toLowerCase();
  const useGlobal = sameForAll === '' || sameForAll === 'y' || sameForAll === 'yes';

  rl.close();

  const cfg: WorkspaceConfig = {
    name,
    root: path.resolve(root),
    ceo: { provider: 'openai-compatible', apiKey, baseURL, model, maxTokens: 4096 },
    agents: useGlobal ? {} : {
      // Empty — user can edit ~/.koda/workspaces/<name>/config.json to override per agent
    },
    createdAt: new Date().toISOString(),
  };

  saveWorkspace(cfg);
  setActive(name);

  console.log(chalk.green(`\n✓ Workspace "${name}" created and set as active.`));
  console.log(chalk.dim(`  Config: ${os.homedir()}/.koda/workspaces/${name}/config.json\n`));

  return cfg;
}
