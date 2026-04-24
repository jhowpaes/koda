import { execSync } from 'child_process';
import readline from 'readline';
import chalk from 'chalk';
import type { Agent } from '../core/agent.js';

const COMMIT_PROMPT = `You are an expert at writing git commit messages.
Given a git diff, write a concise commit message following conventional commits format.

Rules:
- First line: type(scope): short description (max 72 chars)
- Types: feat, fix, refactor, docs, test, chore, perf, style
- Use imperative mood ("add" not "added")
- No period at end
- If needed, add a blank line and 1-2 lines of body

Return ONLY the commit message, nothing else.`;

function confirm(prompt: string): Promise<boolean> {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, answer => {
      rl.close();
      resolve(answer.toLowerCase() === 's' || answer.toLowerCase() === 'y');
    });
  });
}

function promptEdit(prompt: string, defaultValue: string): Promise<string> {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    process.stdout.write(`${prompt} [${chalk.dim('enter to confirm, or type to override')}]\n`);
    process.stdout.write(chalk.cyan('> '));
    rl.question('', answer => {
      rl.close();
      resolve(answer.trim() || defaultValue);
    });
  });
}

export async function generateCommit(agent: Agent): Promise<void> {
  let diff: string;

  try {
    diff = execSync('git diff --cached', { encoding: 'utf-8' });
  } catch {
    console.error(chalk.red('Not a git repository or git not found.'));
    return;
  }

  if (!diff.trim()) {
    console.log(chalk.yellow('No staged changes. Stage files with `git add` first.'));
    const stageAll = await confirm(chalk.cyan('Stage all changes now? [y/N] '));
    if (!stageAll) return;
    execSync('git add -A');
    diff = execSync('git diff --cached', { encoding: 'utf-8' });
  }

  if (!diff.trim()) {
    console.log(chalk.dim('No changes to commit.'));
    return;
  }

  const truncatedDiff = diff.slice(0, 12000);
  console.log(chalk.dim('\nGenerating commit message...\n'));

  const message = await agent.callWithSystemPromptSilent(
    COMMIT_PROMPT,
    `Generate a commit message for this diff:\n\n${truncatedDiff}`
  );

  console.log(chalk.bold('Suggested message:'));
  console.log(chalk.green(message.trim()));
  console.log();

  const final = await promptEdit('Use this message?', message.trim());
  const ok = await confirm(chalk.yellow(`\nCommit with: "${final}" ? [y/N] `));

  if (ok) {
    execSync(`git commit -m ${JSON.stringify(final)}`);
    console.log(chalk.green('\n✓ Committed'));
  } else {
    console.log(chalk.dim('Cancelled.'));
  }
}
