import { createPatch } from 'diff';
import readline from 'readline';
import fs from 'fs';
import chalk from 'chalk';

export function extractCodeBlock(response: string): string | null {
  const match = response.match(/```[\w]*\n([\s\S]*?)```/);
  return match ? match[1] : null;
}

function colorDiff(patch: string): void {
  for (const line of patch.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) {
      process.stdout.write(chalk.bold(line) + '\n');
    } else if (line.startsWith('+')) {
      process.stdout.write(chalk.green(line) + '\n');
    } else if (line.startsWith('-')) {
      process.stdout.write(chalk.red(line) + '\n');
    } else if (line.startsWith('@@')) {
      process.stdout.write(chalk.cyan(line) + '\n');
    } else {
      process.stdout.write(line + '\n');
    }
  }
}

function confirm(prompt: string): Promise<boolean> {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, answer => {
      rl.close();
      resolve(answer.toLowerCase() === 's' || answer.toLowerCase() === 'y');
    });
  });
}

export async function applyEdit(filePath: string, newContent: string): Promise<boolean> {
  const original = fs.readFileSync(filePath, 'utf-8');

  if (original === newContent) {
    console.log(chalk.dim('No changes detected.'));
    return false;
  }

  const patch = createPatch(filePath, original, newContent, '', '');
  console.log(chalk.bold('\n─── Diff ───────────────────────────────────'));
  colorDiff(patch);
  console.log(chalk.bold('─────────────────────────────────────────────\n'));

  const ok = await confirm(chalk.yellow('Apply changes? [y/N] '));
  if (ok) {
    fs.writeFileSync(filePath, newContent, 'utf-8');
    console.log(chalk.green('✓ File updated'));
    return true;
  }
  console.log(chalk.dim('Cancelled.'));
  return false;
}
