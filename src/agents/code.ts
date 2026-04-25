import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { config } from '../config.js';
import { createProvider } from '../llm/provider.js';
import { Agent } from '../core/agent.js';
import { buildContext, buildFileContext, buildSystemPrompt } from '../context/builder.js';
import { extractCodeBlock } from '../actions/editor.js';
import { projectRoot } from '../utils/git.js';
import { createMCPServer } from '../mcp/server.js';

// All output goes to stderr — stdout is reserved for the MCP stdio protocol.
const log = (msg: string) => process.stderr.write(`[code-agent] ${msg}\n`);

const agent = new Agent(createProvider(config), config.model);

// ─── Prompts (same logic as src/commands/*, but used in silent/no-stdout mode) ─

const BASE_PROMPT = 'Você é um assistente especialista em engenharia de software trabalhando em uma base de código. Seja conciso e preciso. Responda SEMPRE em português do Brasil.';

const REVIEW_PROMPT = `Você é um revisor de código sênior. Analise o arquivo e forneça uma revisão estruturada.

Formate sua resposta assim:

## Revisão de Código: <nome do arquivo>

### Problemas
- [L<linha>] <descrição> — <severidade: crítico/aviso/sugestão>

### Sugestões
- <sugestão de melhoria>

### Geral
<resumo em 1-2 frases>

Seja conciso. Foque em problemas reais: bugs, segurança, performance, manutenibilidade.
Responda SEMPRE em português do Brasil.`;

const EXPLAIN_PROMPT = `Você é um especialista em engenharia de software. Explique o que este arquivo faz de forma clara e concisa.

Formate sua resposta assim:

## <nome do arquivo>

<resumo em 1-2 frases do que este arquivo faz>

### Responsabilidades
- <responsabilidade principal>

### Exportações / funções principais
- <nome>: <o que faz>

### Dependências
- <o que importa e por quê>

Seja breve. Responda SEMPRE em português do Brasil.`;

const COMMIT_PROMPT = `Você é um especialista em mensagens de commit git.
Dado um git diff, escreva uma mensagem de commit concisa seguindo o formato conventional commits.

Regras:
- Primeira linha: tipo(escopo): descrição curta (máx 72 chars)
- Tipos: feat, fix, refactor, docs, test, chore, perf, style
- Use o modo imperativo ("adiciona" e não "adicionado")
- Sem ponto final
- Se necessário, adicione uma linha em branco e 1-2 linhas de corpo

Retorne APENAS a mensagem de commit, nada mais.`;

const PLAN_PROMPT = `Você é um engenheiro de software. Dada uma tarefa, retorne um plano JSON de arquivos a criar ou editar.

Retorne APENAS JSON válido neste formato:
{
  "steps": [
    { "action": "create" | "edit", "file": "caminho/relativo.ts", "description": "o que fazer em português" }
  ]
}

Máximo de 5 passos. Use caminhos relativos à raiz do projeto. Sem markdown, sem explicação — apenas JSON.`;

// ─── Helpers ────────────────────────────────────────────────────────────────

function resolveFile(file: string): string {
  return path.isAbsolute(file) ? file : path.resolve(projectRoot(), file);
}

function parsePlan(raw: string): Array<{ action: string; file: string; description: string }> | null {
  try {
    const json = raw.match(/\{[\s\S]*\}/)?.[0];
    if (!json) return null;
    const parsed = JSON.parse(json);
    return Array.isArray(parsed.steps) ? parsed.steps : null;
  } catch { return null; }
}

// ─── MCP Server ──────────────────────────────────────────────────────────────

const server = createMCPServer('koda-code-agent', '1.0.0', [
  {
    definition: {
      name: 'ask',
      description: 'Ask a question about the current codebase',
      inputSchema: {
        type: 'object',
        properties: {
          query:   { type: 'string', description: 'The question to ask' },
          context: { type: 'string', description: 'Results from previous steps (injected automatically by CEO)' },
        },
        required: ['query'],
      },
    },
    handler: async ({ query, context }) => {
      const q = String(query);
      const codeCtx = buildContext(q, config.contextBudget);
      let content = codeCtx ? `${q}\n\nRelevant code:\n${codeCtx}` : q;
      if (context) content += `\n\n--- Contexto dos passos anteriores ---\n${context}`;
      return agent.callWithSystemPromptSilent(buildSystemPrompt(BASE_PROMPT), content);
    },
  },

  {
    definition: {
      name: 'edit_file',
      description: 'Edit a file based on an instruction. Applies the change directly without confirmation.',
      inputSchema: {
        type: 'object',
        properties: {
          file:        { type: 'string', description: 'Relative path to the file from project root' },
          instruction: { type: 'string', description: 'What to change in the file' },
          context:     { type: 'string', description: 'Results from previous steps (injected automatically by CEO)' },
        },
        required: ['file', 'instruction'],
      },
    },
    handler: async ({ file, instruction, context }) => {
      const filePath = resolveFile(String(file));
      if (!fs.existsSync(filePath)) return `Arquivo não encontrado: ${file}`;
      const inst = context
        ? `${String(instruction)}\n\n--- Contexto dos passos anteriores ---\n${context}`
        : String(instruction);
      const response = await agent.editSilent(filePath, inst);
      const newContent = extractCodeBlock(response);
      if (!newContent) return 'Não foi possível extrair o conteúdo do arquivo da resposta do LLM.';
      fs.writeFileSync(filePath, newContent, 'utf-8');
      return `✓ Editado: ${file}`;
    },
  },

  {
    definition: {
      name: 'explain_file',
      description: 'Explain what a file does — responsibilities, exports, dependencies',
      inputSchema: {
        type: 'object',
        properties: {
          file: { type: 'string', description: 'Relative path to the file from project root' },
        },
        required: ['file'],
      },
    },
    handler: async ({ file }) => {
      const filePath = resolveFile(String(file));
      if (!fs.existsSync(filePath)) return `Arquivo não encontrado: ${file}`;
      const fileContext = buildFileContext(filePath);
      return agent.callWithSystemPromptSilent(EXPLAIN_PROMPT, `Explique este arquivo:\n\n${fileContext}`);
    },
  },

  {
    definition: {
      name: 'review_file',
      description: 'Code review a file for bugs, security issues, and improvements',
      inputSchema: {
        type: 'object',
        properties: {
          file: { type: 'string', description: 'Relative path to the file from project root' },
        },
        required: ['file'],
      },
    },
    handler: async ({ file }) => {
      const filePath = resolveFile(String(file));
      if (!fs.existsSync(filePath)) return `Arquivo não encontrado: ${file}`;
      const fileContext = buildFileContext(filePath);
      return agent.callWithSystemPromptSilent(REVIEW_PROMPT, `Revise este arquivo:\n\n${fileContext}`);
    },
  },

  {
    definition: {
      name: 'run_task',
      description: 'Plan and autonomously execute a coding task (creates or edits files without confirmation)',
      inputSchema: {
        type: 'object',
        properties: {
          task:    { type: 'string', description: 'The coding task to execute in natural language' },
          context: { type: 'string', description: 'Results from previous steps (injected automatically by CEO)' },
        },
        required: ['task'],
      },
    },
    handler: async ({ task, context }) => {
      const t = String(task);
      log(`run_task: ${t}`);

      const taskWithContext = context
        ? `${t}\n\n--- Contexto dos passos anteriores (use para encontrar arquivos e entender o problema) ---\n${context}`
        : t;

      const planRaw = await agent.callWithSystemPromptSilent(
        PLAN_PROMPT,
        `Task: ${taskWithContext}\n\nCurrent directory: ${projectRoot()}`
      );

      const steps = parsePlan(planRaw);
      if (!steps || steps.length === 0) {
        return 'Não foi possível gerar um plano. Tente reformular a tarefa.';
      }

      const capped = steps.slice(0, 5);
      const results: string[] = [`Plano: ${capped.length} passo(s)\n`];

      for (const [i, step] of capped.entries()) {
        const filePath = resolveFile(step.file);
        log(`Passo ${i + 1}/${capped.length}: ${step.action} ${step.file}`);

        const existingContext = fs.existsSync(filePath) ? buildFileContext(filePath) : '';
        const prompt = existingContext
          ? `Tarefa: ${step.description}\n\nArquivo existente:\n${existingContext}`
          : `Tarefa: ${step.description}\n\nCriar arquivo: ${step.file}`;

        const sysprompt = existingContext
          ? 'Você é um engenheiro especialista. Edite o arquivo conforme instruído. Retorne APENAS o conteúdo completo do arquivo em um bloco de código. Sem explicações.'
          : 'Você é um engenheiro especialista. Crie o arquivo conforme instruído. Retorne APENAS o conteúdo completo do arquivo em um bloco de código. Sem explicações.';

        const response = await agent.callWithSystemPromptSilent(sysprompt, prompt);
        const newContent = extractCodeBlock(response);

        if (!newContent) {
          results.push(`[${i + 1}] IGNORADO ${step.file} — sem bloco de código na resposta`);
          continue;
        }

        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, newContent, 'utf-8');
        results.push(`[${i + 1}] ${step.action === 'create' ? 'CRIADO' : 'EDITADO'} ${step.file}`);
      }

      results.push('\n✓ Concluído');
      return results.join('\n');
    },
  },

  {
    definition: {
      name: 'commit',
      description: 'Generate a commit message from staged changes and commit. Optionally stages all changes first.',
      inputSchema: {
        type: 'object',
        properties: {
          stage_all: { type: 'boolean', description: 'Stage all changes before committing (git add -A)' },
        },
      },
    },
    handler: async ({ stage_all }) => {
      try {
        if (stage_all) execSync('git add -A', { cwd: projectRoot() });

        const diff = execSync('git diff --cached', { encoding: 'utf-8', cwd: projectRoot() });
        if (!diff.trim()) return 'No staged changes to commit.';

        const message = await agent.callWithSystemPromptSilent(
          COMMIT_PROMPT,
          `Generate a commit message for this diff:\n\n${diff.slice(0, 12000)}`
        );

        const finalMessage = message.trim();
        execSync(`git commit -m ${JSON.stringify(finalMessage)}`, { cwd: projectRoot() });
        return `✓ Commit realizado: "${finalMessage}"`;
      } catch (err) {
        return `Falha no commit: ${String(err)}`;
      }
    },
  },

  {
    definition: {
      name: 'run_command',
      description: 'Execute a shell command in the project root. Use for running tests, builds, linters, or any verification step.',
      inputSchema: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to run (e.g. "npm test", "npm run build", "npx eslint src/")' },
        },
        required: ['command'],
      },
    },
    handler: async ({ command }) => {
      const cmd = String(command);
      log(`run_command: ${cmd}`);
      try {
        const output = execSync(cmd, {
          cwd: projectRoot(),
          encoding: 'utf-8',
          timeout: 60000,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        return `✓ Comando executado: ${cmd}\n\n${output.trim()}`;
      } catch (err: unknown) {
        const e = err as { stdout?: string; stderr?: string; message?: string };
        const out = [e.stdout, e.stderr].filter(Boolean).join('\n').trim();
        return `✕ Comando falhou: ${cmd}\n\n${out || String(err)}`;
      }
    },
  },
]);

server.start().catch(err => {
  log(`Fatal: ${err}`);
  process.exit(1);
});
