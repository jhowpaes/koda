# Koda

Desktop app e CLI de AI para desenvolvimento. Entende o seu codebase completo via contexto de projeto e funciona com qualquer LLM compatível com a API OpenAI — GLM, OpenAI, Groq, Ollama e outros.

---

## Desktop App

```bash
npm install
npm run desktop        # modo dev
npm run dist:mac       # build .dmg para macOS
```

### Painéis

| Painel | O que faz |
|---|---|
| **Editor** | CodeMirror 6, syntax highlighting para 15+ linguagens, salvar com `Cmd+S` |
| **Git** | Stage/unstage, diff inline, commit com geração de mensagem via IA, push/pull |
| **Chat** | Histórico de sessão persistente por workspace, contexto do codebase injetado automaticamente |
| **KODA** | CEO agent: orquestra code/review/git agents em tarefas multi-step; toggle por workspace |

### Painel KODA

O painel KODA é o CEO agent integrado ao desktop. Cada workspace tem seu próprio toggle Chat ↔ KODA.

**Como funciona:**

1. Digite a tarefa no campo de input (ex: `"revisa src/auth.ts, corrige os bugs e commita"`)
2. O CEO planeja automaticamente os steps necessários, mostrando complexidade (`simple` / `moderate` / `complex`)
3. Cada step é executado em sequência com progresso visível — agente, tool e descrição
4. O resultado de cada step alimenta o próximo automaticamente
5. Ao finalizar, exibe um summary da execução

**Funcionalidades:**
- Abas por agente (`code` / `review` / `git`) quando há múltiplos steps
- Indicador de status por step: `○` pendente → spinner → `✓` concluído / `✕` erro
- Botão **Stop** para interromper a qualquer momento
- Entrada por voz via STT (🎤) — transcreve e preenche o campo automaticamente
- Leitura do summary em voz via TTS ao concluir (configurável)
- Badge de execução ativa na barra lateral (ponto pulsante por workspace)

**Configuração de voz (Settings → ⚡ KODA):**
- TTS: habilitar, API key OpenAI, voz (alloy/echo/fable/onyx/nova/shimmer), modelo (tts-1 / tts-1-hd), velocidade
- STT: habilitar, API key OpenAI (Whisper)

---

## Como o contexto funciona

Ao abrir um projeto, o Koda:

1. Detecta a raiz via `.git`
2. Seleciona os arquivos mais relevantes por busca heurística de keywords (top 3 de até 300 arquivos)
3. Injeta o `.aicontext` do projeto (se existir) em todo request

O contexto é construído a partir de:
- `.aicontext` — convenções e arquivos-chave do projeto (prioridade máxima, até 3000 chars)
- `package.json` — dependências detectadas automaticamente
- Estrutura de pastas — scan até profundidade 2, excluindo `node_modules`, `dist`, `.git`

---

## Configuração

### Configuração global (`~/.koda/.env`)

```env
LLM_API_KEY=sua_chave_aqui
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o
LLM_MAX_TOKENS=4096
CONTEXT_BUDGET=12000
```

> Execute `koda setup` para configurar de forma interativa.

### `.aicontext` — convenções do projeto

Crie na raiz do projeto. Injetado automaticamente em todo request ao LLM.

```markdown
# Nome do Projeto

## Stack
- Node.js + TypeScript
- Prisma + PostgreSQL

## Convenções
- Sempre usar async/await
- Erros via AppError de src/lib/errors.ts
- Validação com Zod em todos os endpoints

## Arquivos chave
- src/types/index.ts
- src/lib/prisma.ts
```

### `.aiconfig.json` — modelo por projeto

Sobrescreve o LLM para um projeto específico. Tem prioridade sobre as variáveis de ambiente. A API key nunca vai aqui.

```json
{
  "model": "gpt-4o",
  "baseURL": "https://api.openai.com/v1",
  "maxTokens": 8192,
  "contextBudget": 10000
}
```

---

## Suporte a LLMs

Qualquer provedor com API compatível com OpenAI funciona via `LLM_BASE_URL`:

| Provedor | BASE_URL | Modelo |
|---|---|---|
| OpenAI | `https://api.openai.com/v1` | `gpt-4o` |
| Z.ai (GLM) | `https://api.z.ai/api/coding/paas/v4` | `glm-5.1` |
| Groq | `https://api.groq.com/openai/v1` | `llama-3.1-70b-versatile` |
| Ollama (local) | `http://localhost:11434/v1` | `llama3.2` |

---

## CLI

```bash
npm run link    # instala o comando `koda` globalmente
koda setup      # configura API key e modelo
```

### Comandos individuais

```bash
koda ask "como funciona o sistema de autenticação?"
koda edit src/api/checkout.ts -i "adicionar validação de input"
koda review src/api/users.ts
koda explain src/core/agent.ts
koda commit
koda run "adicionar middleware de autenticação JWT"
koda chat
koda chat --new    # nova sessão, limpa histórico
```

### CEO Agent — tarefas multi-step

O `koda task` orquestra automaticamente os agentes de code, review e git para completar tarefas complexas:

```bash
koda task "revisa src/auth.ts, corrige os problemas e commita"
koda task "cria testes para src/payments.ts e faz push"
```

O CEO planeja os passos necessários, executa cada agente na ordem certa e injeta o resultado de cada passo no próximo.

### Abrir o app desktop

```bash
koda open                          # abre na pasta atual
koda open ~/projects/meu-projeto   # abre em outra pasta
```

### Workspaces

Workspaces isolam configuração de LLM e root por projeto. Cada workspace pode usar um modelo diferente para o CEO e para cada agente individual.

```bash
koda workspace new              # cria workspace interativamente
koda workspace list             # lista todos os workspaces
koda workspace use meu-projeto  # ativa um workspace
koda workspace show             # detalhes do workspace ativo
koda workspace delete <name>    # remove workspace
```

Config salva em `~/.koda/workspaces/<name>/config.json`.

---

## CEO Agent

O CEO Agent orquestra 3 agentes especializados via protocolo MCP (stdio):

| Agente | Tools disponíveis |
|---|---|
| **code** | `ask`, `edit_file`, `explain_file`, `review_file`, `run_task`, `run_command`, `commit` |
| **review** | `review_file`, `review_diff`, `security_audit` |
| **git** | `get_status`, `get_diff`, `commit`, `create_branch`, `push`, `get_log` |

O CEO é minimalista: usa apenas os agentes e passos necessários para a tarefa (máximo 5 steps). O resultado de cada step é injetado automaticamente como contexto no step seguinte.

---

## Ícone

O ícone fonte fica em `build/icon.svg`. Para regenerar os formatos necessários para o build:

```bash
npm run gen-icon
# gera: build/icon.png (Linux), build/icon.icns (macOS), build/icon.ico (Windows)
# requer: brew install librsvg imagemagick
```

---

## Estrutura do projeto

```
electron/
  main.ts               → processo principal Electron + handlers IPC
  preload.ts            → bridge main ↔ renderer
  renderer/             → React app (UI)

src/
  cli/index.ts          → ponto de entrada único do CLI (koda)
  ceo/
    agent.ts            → CEO Agent: orquestra agentes via MCP
    planner.ts          → geração de plano via LLM (CeoPlan)
    cli.ts              → entry point legado do CEO (não usado como bin)
  agents/
    code.ts             → MCP server: agente de código
    review.ts           → MCP server: agente de revisão
    git.ts              → MCP server: agente git
  core/
    agent.ts            → agente principal (ask, edit, chat, review, commit)
    session-store.ts    → histórico persistente por projeto (~/.ai-sessions/)
  llm/
    provider.ts         → adapter OpenAI-compatible
  context/
    builder.ts          → seleção heurística de arquivos por keyword
    project.ts          → lê .aicontext, .aiconfig.json, package.json
  workspace/
    store.ts            → CRUD de workspaces (~/.koda/workspaces/)
    setup.ts            → setup interativo de workspace
  mcp/
    client.ts           → cliente MCP (stdio)
    server.ts           → utilitário para criação de servidores MCP
  commands/
    review.ts           → code review
    explain.ts          → explicação de arquivo
    commit.ts           → geração de mensagem de commit
    run.ts              → agente autônomo com plano + confirmação
  config.ts             → carrega config global (~/.koda/.env + .aiconfig.json)

build/
  icon.svg              → ícone fonte (vetorial)
  icon.icns             → macOS (gerado via npm run gen-icon)
  icon.ico              → Windows (gerado via npm run gen-icon)
  icon.png              → Linux / electron-builder (gerado via npm run gen-icon)
  notarize.cjs          → hook de notarização macOS (requer env vars)
```

---

## Contribuindo

Veja [CONTRIBUTING.md](./CONTRIBUTING.md) para instruções de setup e como enviar pull requests.

---

## Licença

[MIT](./LICENSE)
