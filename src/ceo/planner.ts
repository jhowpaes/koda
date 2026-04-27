import fs from 'fs';
import path from 'path';
import type { LLMProvider } from '../llm/types.js';
import { buildFileContext } from '../context/builder.js';
import type { CeoPlan } from './types.js';

// ─── Agent manifest ───────────────────────────────────────────────────────────

const AGENT_MANIFEST = `
## code (Agente de Código) — executa e verifica
- ask: { query: string } — pergunta sobre o código-fonte
- edit_file: { file: string, instruction: string } — edição direcionada em um único arquivo
- explain_file: { file: string } — explica o que um arquivo faz
- review_file: { file: string } — revisão de código buscando bugs e problemas
- run_task: { task: string } — planeja e executa uma tarefa que altera múltiplos arquivos
- run_command: { command: string } — executa um comando shell (ex: "npm test", "npm run build", "npx eslint src/")
- commit: { stage_all?: boolean } — gera mensagem de commit e commita

## review (Agente de Revisão) — porta de qualidade
- review_file: { file: string } — revisão estruturada com problemas e sugestões
- review_diff: { diff?: string } — revisa o diff staged atual ou um texto de diff fornecido
- security_audit: { file: string } — auditoria de segurança: injeções, falhas de auth, exposição

## git (Agente Git) — controle de versão
- get_status: {} — git status
- get_diff: { staged?: boolean } — diff atual
- commit: { stage_all?: boolean, message?: string } — commit (gera mensagem se não fornecida)
- create_branch: { name: string } — cria e faz checkout de uma branch
- push: { branch?: string, set_upstream?: boolean } — push para o remote
- get_log: { limit?: number } — histórico de commits
`.trim();

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Você é KODA, agente CEO de desenvolvimento de software. Analise a tarefa e gere o plano de execução MÍNIMO e CORRETO.

RESPONDA SEMPRE em português do Brasil. Os campos "thinking" e "description" devem estar em português.

## Raciocínio obrigatório em 3 etapas

### ETAPA 1 — Classifique o tipo de tarefa
- investigate: entender/explicar/perguntar → máx 1 passo
- modify: escrever ou editar código → 2-3 passos
- verify: rodar testes, build, lint → 1-2 passos
- review: avaliar qualidade ou segurança (só se explicitamente pedido) → 1-2 passos
- ship: commit ou push (só se explicitamente pedido) → 1-2 passos

### ETAPA 2 — Determine se a localização é conhecida
- Localização CONHECIDA: tarefa cita @arquivo ou caminho exato → use o caminho diretamente
- Localização DESCONHECIDA: tarefa descreve comportamento/bug sem citar arquivo:
  → OBRIGATÓRIO: passo 1 = code.ask para localizar e confirmar o problema
  → Só parta para correção no passo 2, usando contexto do passo anterior

### ETAPA 3 — Selecione agentes com o mínimo necessário
- Investigar/perguntar → code.ask (1 passo)
- Explicar arquivo → code.explain_file (1 passo)
- Revisar arquivo → code.review_file (1 passo)
- Editar 1 arquivo → code.edit_file (1 passo)
- Editar múltiplos arquivos → code.run_task (1 passo)
- Verificar/testar → code.run_command
- Commit → git.commit (APENAS se explicitamente pedido)
- Push → git.push (APENAS se explicitamente pedido)
- Revisão de qualidade → review.review_diff (APENAS se explicitamente pedido)
- Auditoria de segurança → review.security_audit (APENAS se explicitamente pedido)

## Regras absolutas
- NUNCA adicione review ou git automaticamente — só quando o usuário pedir
- NUNCA adicione "rodar testes" automaticamente — só quando pedido
- Máximo 5 passos
- investigate = 1 passo, modify simples = 2 passos, modify complexo = 3-4 passos
- Caminhos de arquivo relativos à raiz do projeto
- Contexto: cada passo recebe automaticamente o resultado do passo anterior — não re-pesquise o que já foi encontrado

Agentes disponíveis:
${AGENT_MANIFEST}

Retorne APENAS JSON válido (sem markdown, sem texto fora do JSON):
{
  "thinking": "tipo: X | localização: conhecida/desconhecida | passos mínimos necessários: N | justificativa em português",
  "complexity": "simple|moderate|complex",
  "steps": [
    { "agent": "code|review|git", "tool": "nome_da_tool", "args": { "chave": "valor" }, "description": "descrição em português do que este passo faz" }
  ],
  "parallel": false
}

parallel: true APENAS quando os passos são completamente independentes entre si.
Retorne APENAS JSON válido.`;

// ─── File reference extraction ────────────────────────────────────────────────

// Resolves @file and bare path references from the task text and injects their content
function extractReferencedFiles(task: string, root: string): string {
  const seen = new Set<string>();
  const refs: string[] = [];

  // @src/foo/bar.ts style (explicit)
  for (const m of task.matchAll(/@([\w.\-/]+\.\w+)/g)) refs.push(m[1]);

  // bare paths like src/foo/bar.ts (common prefixes)
  for (const m of task.matchAll(/\b((?:src|lib|test|tests|app|pages|components|utils|api|config|electron)\/[\w.\-/]+\.\w+)/g)) {
    refs.push(m[1]);
  }

  const contexts: string[] = [];
  for (const ref of refs) {
    if (seen.has(ref)) continue;
    seen.add(ref);
    const filePath = path.resolve(root, ref);
    if (fs.existsSync(filePath)) {
      contexts.push(buildFileContext(filePath, 3000));
    }
  }

  return contexts.join('\n\n');
}

// ─── Plan generation ──────────────────────────────────────────────────────────

export async function generatePlan(
  provider: LLMProvider,
  task: string,
  projectRoot?: string
): Promise<CeoPlan | null> {
  // Inject referenced file content so the CEO can reason about the actual code
  const fileContext = projectRoot ? extractReferencedFiles(task, projectRoot) : '';
  const langReminder = '\n\n⚠️ Responda em português do Brasil. Os campos "thinking" e "description" devem estar em português.';
  const userContent = fileContext
    ? `Tarefa: ${task}\n\nArquivos referenciados:\n${fileContext}${langReminder}`
    : `Tarefa: ${task}${langReminder}`;

  const res = await provider.complete({
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user',   content: userContent },
    ],
  });

  try {
    const json = res.content.match(/\{[\s\S]*\}/)?.[0];
    if (!json) return null;
    const parsed = JSON.parse(json) as CeoPlan;
    if (!Array.isArray(parsed.steps)) return null;
    return { ...parsed, steps: parsed.steps.slice(0, 5) };
  } catch {
    return null;
  }
}
