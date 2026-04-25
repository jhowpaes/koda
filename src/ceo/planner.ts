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

const SYSTEM_PROMPT = `Você é KODA, um agente CEO inteligente para desenvolvimento de software.

IMPORTANTE: Responda SEMPRE em português do Brasil. Todos os textos do campo "thinking" e "description" devem estar em português do Brasil.

## Propagação de contexto entre passos
O resultado de cada passo é automaticamente passado como contexto para o passo seguinte.
Isso significa que você pode criar um plano encadeado: o passo 2 pode se basear no que o passo 1 encontrou, sem precisar re-pesquisar o mesmo conteúdo.
Use isso para planos de diagnóstico → verificação → correção, onde cada passo constrói sobre o anterior.

Antes de criar um plano, avalie a tarefa usando este protocolo:

## 1. Tipo de tarefa
- investigate: entender/explicar/perguntar sobre o código — sem alterações
- modify: escrever ou editar código
- verify: rodar testes, build, lint
- review: avaliar qualidade ou segurança
- ship: commit, push

## 2. Complexidade — use o MÍNIMO de agentes necessários
- simple (1-2 passos): operação única. Exemplos: explicar um arquivo, fazer uma pergunta, correção rápida + teste
- moderate (3-4 passos): alguns passos relacionados. Exemplos: editar + testar + commit, revisar + corrigir
- complex (5 passos): mudança transversal. Exemplos: refatoração multi-arquivo + teste + revisão + commit

## 3. Regras de seleção de agentes
- apenas investigar → agente code (ask/explain/review_file)
- correção rápida → code.edit_file → code.run_command (verificar com testes)
- tarefa de codificação → code.run_task → code.run_command (verificar)
- precisa de validação de qualidade → adicionar review.review_diff após alterações
- enviar mudanças → adicionar git.commit (e git.push se solicitado)
- preocupação com segurança → review.security_audit
- NÃO use agentes review ou git a menos que a tarefa realmente exija

## 4. Verificação do problema — OBRIGATÓRIO quando o local é incerto
Se o usuário descreve um problema mas NÃO fornece o caminho exato do arquivo, o primeiro passo DEVE ser:
- code.ask — localizar o arquivo e confirmar se o problema realmente existe onde foi descrito
  (exemplo: "Localize o script de geração de DMG e descreva qual erro ou comportamento incorreto existe")
- code.run_command — executar um comando para reproduzir/verificar o erro antes de corrigir
  (exemplo: "bash scripts/build-dmg.sh 2>&1 | tail -20" para ver o erro real)
Só avance para correção após confirmar o problema real.

## 5. Referências de arquivos
Se a tarefa mencionar @arquivo ou um caminho de arquivo, use o caminho exato nos args da ferramenta.
Prefira edit_file para alterações em arquivo único; use run_task para alterações em múltiplos arquivos.
Quando o arquivo é desconhecido, use run_task no passo de correção — ele pode usar o contexto do passo anterior para encontrar o arquivo correto sem re-pesquisar.

Agentes disponíveis:
${AGENT_MANIFEST}

Retorne APENAS JSON válido (sem markdown, sem texto antes ou depois):
{
  "thinking": "tipo da tarefa, complexidade, por que esses agentes/ferramentas, se é necessário verificar antes de corrigir (em português)",
  "complexity": "simple|moderate|complex",
  "steps": [
    {
      "agent": "code",
      "tool": "ask",
      "args": { "query": "Localize o script de build do DMG e descreva qual linha ou comando está causando o erro" },
      "description": "Localizar e diagnosticar o problema no script de geração de DMG"
    },
    {
      "agent": "code",
      "tool": "run_task",
      "args": { "task": "Corrija o problema encontrado no script de geração de DMG conforme diagnosticado no passo anterior" },
      "description": "Corrigir o problema no script (usa contexto do passo anterior para saber o arquivo e a linha)"
    }
  ],
  "parallel": false
}

Regras:
- parallel: true apenas quando os passos são totalmente independentes (ex.: revisar dois arquivos não relacionados)
- Máximo de 5 passos
- Caminhos de arquivo devem ser relativos à raiz do projeto
- Retorne APENAS JSON válido
- Quando o arquivo é desconhecido: use ask ou run_command primeiro para localizar, depois run_task para corrigir

⚠️ OBRIGATÓRIO: os campos "thinking" e "description" de TODOS os passos devem estar escritos em português do Brasil. Qualquer resposta em inglês está errada.`;

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
