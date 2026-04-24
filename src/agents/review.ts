import fs from 'fs';
import { execSync } from 'child_process';
import { config } from '../config.js';
import { createProvider } from '../llm/provider.js';
import { Agent } from '../core/agent.js';
import { buildFileContext } from '../context/builder.js';
import { projectRoot } from '../utils/git.js';
import { createMCPServer } from '../mcp/server.js';
import path from 'path';

const log = (msg: string) => process.stderr.write(`[review-agent] ${msg}\n`);

const agent = new Agent(createProvider(config), config.model);

// ─── Prompts ─────────────────────────────────────────────────────────────────

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

const DIFF_REVIEW_PROMPT = `Você é um revisor de código sênior. Revise o seguinte git diff e identifique problemas.

Formate sua resposta assim:

## Revisão do Diff

### Problemas
- [<arquivo>] <descrição> — <severidade: crítico/aviso/sugestão>

### Pontos positivos
- <o que foi bem feito>

### Geral
<resumo em 1-2 frases e recomendação>

Foque em correção, segurança, mudanças que quebram compatibilidade e testes faltando.
Responda SEMPRE em português do Brasil.`;

const SECURITY_PROMPT = `Você é um engenheiro de segurança. Realize uma auditoria de segurança do arquivo a seguir.

Formate sua resposta assim:

## Auditoria de Segurança: <nome do arquivo>

### Vulnerabilidades
- [L<linha>] <vulnerabilidade> — <severidade: crítica/alta/média/baixa>
  Correção: <sugestão de correção>

### Observações de segurança
- <observação>

### Veredicto
<APROVADO / REQUER ATENÇÃO / PROBLEMAS CRÍTICOS> — <motivo em 1 linha>

Verifique: injeção (SQL, comando, XSS), falhas de autenticação, deserialização insegura,
exposição de dados sensíveis, controle de acesso quebrado, dependências inseguras.
Responda SEMPRE em português do Brasil.`;

// ─── MCP Server ──────────────────────────────────────────────────────────────

const server = createMCPServer('koda-review-agent', '1.0.0', [
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
      const filePath = path.resolve(projectRoot(), String(file));
      if (!fs.existsSync(filePath)) return `Arquivo não encontrado: ${file}`;
      log(`review_file: ${file}`);
      const fileContext = buildFileContext(filePath);
      return agent.callWithSystemPromptSilent(REVIEW_PROMPT, `Revise este arquivo:\n\n${fileContext}`);
    },
  },

  {
    definition: {
      name: 'review_diff',
      description: 'Review a git diff. Uses current staged diff if no diff is provided.',
      inputSchema: {
        type: 'object',
        properties: {
          diff: { type: 'string', description: 'Git diff text to review (optional — uses staged diff if omitted)' },
        },
      },
    },
    handler: async ({ diff }) => {
      let diffText = diff ? String(diff) : '';
      if (!diffText) {
        try {
          diffText = execSync('git diff --cached', { encoding: 'utf-8', cwd: projectRoot() });
          if (!diffText.trim()) {
            diffText = execSync('git diff HEAD', { encoding: 'utf-8', cwd: projectRoot() });
          }
        } catch (err) {
          return `Não foi possível obter o diff: ${String(err)}`;
        }
      }
      if (!diffText.trim()) return 'Nenhum diff encontrado para revisar.';
      log('review_diff');
      return agent.callWithSystemPromptSilent(
        DIFF_REVIEW_PROMPT,
        `Revise este diff:\n\n${diffText.slice(0, 16000)}`
      );
    },
  },

  {
    definition: {
      name: 'security_audit',
      description: 'Security-focused audit of a file — checks for vulnerabilities, injections, auth issues',
      inputSchema: {
        type: 'object',
        properties: {
          file: { type: 'string', description: 'Relative path to the file from project root' },
        },
        required: ['file'],
      },
    },
    handler: async ({ file }) => {
      const filePath = path.resolve(projectRoot(), String(file));
      if (!fs.existsSync(filePath)) return `Arquivo não encontrado: ${file}`;
      log(`security_audit: ${file}`);
      const fileContext = buildFileContext(filePath);
      return agent.callWithSystemPromptSilent(SECURITY_PROMPT, `Audite este arquivo:\n\n${fileContext}`);
    },
  },
]);

server.start().catch(err => {
  log(`Fatal: ${err}`);
  process.exit(1);
});
