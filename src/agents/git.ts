import { execSync } from 'child_process';
import { config } from '../config.js';
import { createProvider } from '../llm/provider.js';
import { Agent } from '../core/agent.js';
import { projectRoot } from '../utils/git.js';
import { createMCPServer } from '../mcp/server.js';

const log = (msg: string) => process.stderr.write(`[git-agent] ${msg}\n`);

const agent = new Agent(createProvider(config), config.model);
const root  = projectRoot();

function git(cmd: string): string {
  return execSync(`git ${cmd}`, { encoding: 'utf-8', cwd: root }).trim();
}

const COMMIT_PROMPT = `Você é um especialista em mensagens de commit git.
Dado um git diff, escreva uma mensagem de commit concisa seguindo o formato conventional commits.

Regras:
- Primeira linha: tipo(escopo): descrição curta (máx 72 chars)
- Tipos: feat, fix, refactor, docs, test, chore, perf, style
- Use o modo imperativo ("adiciona" e não "adicionado")
- Sem ponto final
- Se necessário, adicione uma linha em branco e 1-2 linhas de corpo

Retorne APENAS a mensagem de commit, nada mais.`;

// ─── MCP Server ──────────────────────────────────────────────────────────────

const server = createMCPServer('koda-git-agent', '1.0.0', [
  {
    definition: {
      name: 'get_status',
      description: 'Get the current git status of the repository',
      inputSchema: { type: 'object', properties: {} },
    },
    handler: async () => {
      try { return git('status --short'); }
      catch (err) { return `git status falhou: ${String(err)}`; }
    },
  },

  {
    definition: {
      name: 'get_diff',
      description: 'Get the current git diff. Returns staged diff first, falls back to unstaged.',
      inputSchema: {
        type: 'object',
        properties: {
          staged: { type: 'boolean', description: 'Get only staged diff (default: false — returns staged or unstaged)' },
        },
      },
    },
    handler: async ({ staged }) => {
      try {
        const cmd = staged ? 'diff --cached' : 'diff --cached';
        let diff = git(cmd);
        if (!diff && !staged) diff = git('diff HEAD');
        return diff || 'Nenhuma alteração encontrada.';
      } catch (err) { return `git diff falhou: ${String(err)}`; }
    },
  },

  {
    definition: {
      name: 'commit',
      description: 'Generate a commit message from staged changes and commit. Optionally stages all changes first.',
      inputSchema: {
        type: 'object',
        properties: {
          stage_all: { type: 'boolean', description: 'Run git add -A before committing' },
          message: { type: 'string', description: 'Use this commit message instead of generating one' },
        },
      },
    },
    handler: async ({ stage_all, message }) => {
      try {
        if (stage_all) git('add -A');

        const diff = git('diff --cached');
        if (!diff) return 'Nenhuma alteração staged para commitar.';

        const finalMessage = message
          ? String(message)
          : (await agent.callWithSystemPromptSilent(
              COMMIT_PROMPT,
              `Gere uma mensagem de commit para este diff:\n\n${diff.slice(0, 12000)}`
            )).trim();

        log(`commit: "${finalMessage}"`);
        git(`commit -m ${JSON.stringify(finalMessage)}`);
        return `✓ Commit realizado: "${finalMessage}"`;
      } catch (err) { return `Commit falhou: ${String(err)}`; }
    },
  },

  {
    definition: {
      name: 'create_branch',
      description: 'Create and checkout a new git branch',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Branch name' },
        },
        required: ['name'],
      },
    },
    handler: async ({ name }) => {
      try {
        git(`checkout -b ${String(name)}`);
        return `✓ Branch criada e checkout feito: ${name}`;
      } catch (err) { return `Falha ao criar branch: ${String(err)}`; }
    },
  },

  {
    definition: {
      name: 'push',
      description: 'Push the current branch to the remote origin',
      inputSchema: {
        type: 'object',
        properties: {
          branch: { type: 'string', description: 'Branch to push (default: current branch)' },
          set_upstream: { type: 'boolean', description: 'Set upstream tracking (-u flag)' },
        },
      },
    },
    handler: async ({ branch, set_upstream }) => {
      try {
        const b = branch ? String(branch) : git('rev-parse --abbrev-ref HEAD');
        const flag = set_upstream ? '-u ' : '';
        const output = git(`push ${flag}origin ${b}`);
        return `✓ Push de ${b} para origin\n${output}`;
      } catch (err) { return `Push falhou: ${String(err)}`; }
    },
  },

  {
    definition: {
      name: 'get_log',
      description: 'Get recent git commit history',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Number of commits to show (default: 10)' },
        },
      },
    },
    handler: async ({ limit }) => {
      try {
        const n = Math.min(Number(limit ?? 10), 50);
        return git(`log --oneline -${n}`);
      } catch (err) { return `git log falhou: ${String(err)}`; }
    },
  },
]);

server.start().catch(err => {
  log(`Fatal: ${err}`);
  process.exit(1);
});
