import path from 'path';
import { fileURLToPath } from 'url';
import type { LLMProvider } from '../llm/types.js';
import { MCPClient } from '../mcp/client.js';
import { generatePlan } from './planner.js';
import type { CeoPlan, CeoResult, CeoStep, OnProgress } from './types.js';
import type { WorkspaceConfig } from '../workspace/types.js';
import { agentEnv } from '../workspace/store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveAgentBins(dir?: string): Record<string, { command: string; args: string[] }> {
  const base = dir ?? path.join(__dirname, '..', 'agents');
  return {
    code:   { command: 'node', args: [path.join(base, 'code.js')] },
    review: { command: 'node', args: [path.join(base, 'review.js')] },
    git:    { command: 'node', args: [path.join(base, 'git.js')] },
  };
}

export interface CeoRunOptions {
  onProgress?: OnProgress;
  stopOnError?: boolean;
  projectRoot?: string;  // overrides workspace.root for planner file resolution
  plan?: CeoPlan;        // pre-generated plan — skips the planning LLM call
}

export class CeoAgent {
  private client = new MCPClient();
  private connected = false;
  private agentBins: Record<string, { command: string; args: string[] }>;

  // agentBinsDir: explicit path to compiled agent JS files (used by Electron where __dirname differs)
  constructor(
    private provider: LLMProvider,
    private workspace?: WorkspaceConfig,
    agentBinsDir?: string,
  ) {
    this.agentBins = resolveAgentBins(agentBinsDir);
  }

  private async ensureConnected(): Promise<void> {
    if (this.connected) return;
    for (const [name, bin] of Object.entries(this.agentBins)) {
      const env = this.workspace
        ? agentEnv(this.workspace, name as 'code' | 'review' | 'git')
        : undefined;
      await this.client.connect({ name, ...bin, env });
    }
    this.connected = true;
  }

  async run(task: string, options: CeoRunOptions = {}): Promise<CeoResult> {
    const { onProgress, stopOnError = false, projectRoot } = options;

    await this.ensureConnected();

    const root = projectRoot ?? this.workspace?.root;
    const plan = options.plan ?? await generatePlan(this.provider, task, root);
    if (!plan || plan.steps.length === 0) {
      const summary = 'Não foi possível gerar um plano. Tente reformular a tarefa.';
      onProgress?.({ type: 'done', summary });
      return { plan: { steps: [], parallel: false }, steps: [], summary };
    }

    onProgress?.({ type: 'plan', plan });

    const stepResults: CeoResult['steps'] = [];

    const executeStep = async (step: CeoStep, index: number): Promise<void> => {
      onProgress?.({ type: 'step_start', step, index, total: plan.steps.length });
      try {
        const result = await this.client.callTool(step.agent, step.tool, step.args);
        stepResults[index] = { step, result };
        onProgress?.({ type: 'step_done', step, index, result });
      } catch (err) {
        const error = String(err);
        stepResults[index] = { step, result: '', error };
        onProgress?.({ type: 'step_error', step, index, error });
        if (stopOnError) throw err;
      }
    };

    if (plan.parallel) {
      await Promise.all(plan.steps.map((step, i) => executeStep(step, i)));
    } else {
      for (const [i, step] of plan.steps.entries()) {
        await executeStep(step, i);
        if (stopOnError && stepResults[i]?.error) break;
      }
    }

    const completed = stepResults.filter(r => !r?.error);
    const failed    = stepResults.filter(r =>  r?.error);
    const lines: string[] = [`✓ ${completed.length} passo(s) concluído(s)`];
    if (failed.length > 0) lines.push(`✕ ${failed.length} passo(s) com falha`);
    lines.push('');
    for (const r of stepResults) {
      if (!r) continue;
      const icon = r.error ? '✕' : '✓';
      lines.push(`${icon} [${r.step.agent}] ${r.step.tool} — ${r.step.description}`);
      if (r.error) lines.push(`  Erro: ${r.error}`);
    }
    const summary = lines.join('\n');

    onProgress?.({ type: 'done', summary });
    return { plan, steps: stepResults, summary };
  }

  async close(): Promise<void> {
    await this.client.disconnectAll();
    this.connected = false;
  }
}
