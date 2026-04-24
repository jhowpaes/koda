import fs from 'fs';
import path from 'path';
import readline from 'readline';
import chalk from 'chalk';
import type { Agent } from '../core/agent.js';
import { buildFileContext } from '../context/builder.js';
import { applyEdit, extractCodeBlock } from '../actions/editor.js';

const MAX_STEPS = 5;

interface RunStep {
  action: 'create' | 'edit';
  file: string;
  description: string;
}

interface RunPlan {
  steps: RunStep[];
}

const PLAN_PROMPT = `You are a software engineer. Given a task, return a JSON plan of files to create or edit.

Return ONLY valid JSON in this format:
{
  "steps": [
    { "action": "create" | "edit", "file": "relative/path.ts", "description": "what to do" }
  ]
}

Max ${MAX_STEPS} steps. Use relative paths from the project root. No markdown, no explanation — only JSON.`;

function confirm(prompt: string): Promise<boolean> {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, answer => { rl.close(); resolve(answer.toLowerCase() === 's' || answer.toLowerCase() === 'y'); });
  });
}

function parsePlan(raw: string): RunPlan | null {
  try {
    const json = raw.match(/\{[\s\S]*\}/)?.[0];
    if (!json) return null;
    const parsed = JSON.parse(json) as RunPlan;
    if (!Array.isArray(parsed.steps)) return null;
    return parsed;
  } catch { return null; }
}

export async function runTask(agent: Agent, task: string): Promise<void> {
  console.log(chalk.dim('\nPlanning...\n'));

  const planRaw = await agent.callWithSystemPromptSilent(
    PLAN_PROMPT,
    `Task: ${task}\n\nCurrent directory: ${process.cwd()}`
  );

  const plan = parsePlan(planRaw);
  if (!plan || plan.steps.length === 0) {
    console.log(chalk.yellow('Could not generate a plan. Try rephrasing the task.'));
    return;
  }

  const steps = plan.steps.slice(0, MAX_STEPS);

  console.log(chalk.bold(`Plan (${steps.length} step${steps.length > 1 ? 's' : ''}):\n`));
  steps.forEach((s, i) => {
    const action = s.action === 'create' ? chalk.green('CREATE') : chalk.cyan('EDIT  ');
    console.log(`  ${i + 1}. [${action}] ${s.file}`);
    console.log(chalk.dim(`        ${s.description}`));
  });
  console.log();

  const ok = await confirm(chalk.yellow('Proceed with this plan? [y/N] '));
  if (!ok) { console.log(chalk.dim('Cancelled.')); return; }

  for (const [i, step] of steps.entries()) {
    const filePath = path.resolve(step.file);
    console.log(chalk.bold(`\n[${i + 1}/${steps.length}] ${step.action.toUpperCase()}: ${step.file}`));

    const existingContext = fs.existsSync(filePath) ? buildFileContext(filePath) : '';
    const prompt = existingContext
      ? `Task: ${step.description}\n\nExisting file:\n${existingContext}`
      : `Task: ${step.description}\n\nCreate file: ${step.file}`;

    const response = await agent.callWithSystemPromptSilent(
      `You are an expert engineer. ${existingContext ? 'Edit' : 'Create'} the file as instructed. Return ONLY the complete file content in a fenced code block. No explanation.`,
      prompt
    );

    const newContent = extractCodeBlock(response);
    if (!newContent) {
      console.log(chalk.yellow('No code block in response — skipping this step.'));
      continue;
    }

    if (step.action === 'create') {
      console.log(chalk.dim('\nContent preview (first 10 lines):'));
      console.log(chalk.dim(newContent.split('\n').slice(0, 10).join('\n')));
      console.log();
      const create = await confirm(chalk.yellow(`Create ${step.file}? [y/N] `));
      if (create) {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, newContent, 'utf-8');
        console.log(chalk.green(`✓ Created ${step.file}`));
      } else {
        console.log(chalk.dim('Skipped.'));
      }
    } else {
      if (!fs.existsSync(filePath)) {
        console.log(chalk.yellow(`File not found: ${step.file} — skipping.`));
        continue;
      }
      await applyEdit(filePath, newContent);
    }
  }

  console.log(chalk.bold.green('\n✓ Done'));
}
