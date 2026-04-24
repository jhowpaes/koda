# KODA — Arquitetura do Sistema

> **KODA** é um sistema de agentes de IA para desenvolvimento de software, controlado por um CEO Agent que orquestra agentes especializados via protocolo MCP.

---

## Visão Geral

```
┌────────────────────────────────────────────────────────────────────┐
│                         KODA DESKTOP APP                           │
│                      (Electron + React)                            │
│                                                                    │
│  [ Alpha ●  ]  [ Beta    ]  [ Gamma ●  ]  ← ● = CEO ativo        │
│  (executando)   (idle)       (executando)                          │
│                                                                    │
│  ┌──── Workspace ativo ────────────────────────────────────────┐   │
│  │                                                             │   │
│  │  ┌─────────────────────────────────────────────────────┐   │   │
│  │  │ KODA CEO Panel                              [Stop]  │   │   │
│  │  │  Complexity: moderate                               │   │   │
│  │  │  ▓▓▓▓▓▓░░░░ 2/3 steps                             │   │   │
│  │  │                                                     │   │   │
│  │  │  [code] [review] [git]   ← agent tabs              │   │   │
│  │  │  ✓ [code] edit_file                                │   │   │
│  │  │  ● [code] run_command  (running)                   │   │   │
│  │  │  ○ [git]  commit       (pending)                   │   │   │
│  │  │                                                     │   │   │
│  │  │  [ Describe a task...                       🎤 ▶ ] │   │   │
│  │  └─────────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────┘   │
└──────────────────────────┬─────────────────────────────────────────┘
                           │
              ┌────────────▼────────────┐
              │     KODA CEO AGENT      │
              │                         │
              │  • Avalia complexidade  │
              │  • Seleciona agentes    │
              │  • Detecta @arquivos    │
              │  • Delega via MCP       │
              │  • Emite ProgressEvents │
              └────────────┬────────────┘
                           │  MCP (stdio)
         ┌─────────────────┼─────────────────┐
         ▼                 ▼                 ▼
 ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
 │  CODE AGENT  │  │ REVIEW AGENT │  │  GIT AGENT   │
 │ (MCP Server) │  │ (MCP Server) │  │ (MCP Server) │
 └──────────────┘  └──────────────┘  └──────────────┘
```

---

## Estrutura de Pastas

```
src/
├── cli/                  # CLI original — comandos ai ask/edit/review/run/chat
│   └── index.ts          # Entry point: bin/ai (NUNCA modificado)
│
├── config.ts             # Lê ~/.ai/.env e .env local
│
├── app/
│   └── config.ts         # AppConfig (~/.koda/config.json) — TTS/STT global
│
├── llm/
│   ├── provider.ts       # LLMProvider OpenAI-compatible (z.ai, OpenAI, Groq, Ollama…)
│   ├── types.ts          # Message, LLMRequest, LLMResponse, LLMProvider
│   └── cache.ts          # Cache em memória de respostas
│
├── core/
│   └── agent.ts          # Classe Agent — ask, edit, chat, callWithSystemPrompt(Silent)
│
├── context/
│   ├── builder.ts        # buildContext, buildFileContext, buildSystemPrompt
│   └── project.ts        # .aicontext / .codeai/MEMORY.md por projeto
│
├── commands/             # Comandos do CLI (usados pelo ai e pelo Code Agent)
│   ├── run.ts
│   ├── review.ts
│   ├── explain.ts
│   └── commit.ts
│
├── actions/
│   └── editor.ts         # extractCodeBlock, applyEdit (com diff interativo)
│
├── utils/
│   └── git.ts            # projectRoot()
│
├── mcp/                  # Camada MCP
│   ├── server.ts         # createMCPServer() — helper base para MCP Servers
│   └── client.ts         # MCPClient — conecta e chama tools nos agentes
│
├── agents/               # MCP Servers (processos separados, comunicam via stdio)
│   ├── code.ts           # Code Agent   → dist/agents/code.js
│   ├── review.ts         # Review Agent → dist/agents/review.js
│   └── git.ts            # Git Agent    → dist/agents/git.js
│
├── ceo/                  # CEO Agent
│   ├── types.ts          # CeoPlan, CeoStep, CeoResult, ProgressEvent, TaskComplexity
│   ├── planner.ts        # generatePlan() — avalia complexidade, detecta @arquivos
│   ├── agent.ts          # CeoAgent — orquestra MCP, emite ProgressEvents
│   └── cli.ts            # Entry point: bin/koda + koda workspace <cmd>
│
└── workspace/            # Workspace System
    ├── types.ts          # WorkspaceConfig, LLMConfig, ResolvedAgentConfig
    ├── store.ts          # CRUD: saveWorkspace, loadWorkspace, setActive, agentEnv()
    └── setup.ts          # createWorkspaceInteractive() — setup com readline

electron/
├── main.ts               # Electron main process (IPC: agent, git, shell, koda)
├── preload.ts            # Preload bridge — window.api.* + window.api.koda.*
└── renderer/src/
    ├── App.tsx           # Estado global: workspaces, KODA states, streaming
    ├── main.tsx
    └── components/
        ├── WorkspaceRail.tsx   # Rail lateral com workspaces; ● indica CEO ativo
        ├── KodaPanel.tsx       # CEO chat UI — task input, plan, steps, tabs de agente
        ├── ChatsPanel.tsx      # Chat normal com o LLM (modo Chat)
        ├── RightPanel.tsx      # File explorer + editor de código
        ├── SettingsModal.tsx   # Settings (AI Providers / Agents / ⚡ KODA)
        ├── DiffModal.tsx       # Visualizador de diff para edições
        ├── Chat.tsx
        ├── GitTab.tsx
        ├── EditorTab.tsx
        └── Sidebar.tsx
```

---

## Binários gerados (`dist/`)

| Binário | Origem | Comando |
|---|---|---|
| `dist/index.js` | `src/cli/index.ts` | `ai <comando>` |
| `dist/ceo/cli.js` | `src/ceo/cli.ts` | `koda <task>` / `koda workspace <cmd>` |
| `dist/agents/code.js` | `src/agents/code.ts` | MCP Server — spawned pelo CEO |
| `dist/agents/review.js` | `src/agents/review.ts` | MCP Server — spawned pelo CEO |
| `dist/agents/git.js` | `src/agents/git.ts` | MCP Server — spawned pelo CEO |

---

## Camadas do Sistema

### 1. CLI Original (`ai`)

Mantido intacto. Funciona de forma completamente independente do CEO.

```
ai ask <pergunta>       # pergunta sobre o codebase
ai edit <arquivo>       # edita arquivo com IA
ai review <arquivo>     # review de código
ai explain <arquivo>    # explica um arquivo
ai commit               # gera mensagem de commit
ai run <task>           # executa tarefa com confirmação
ai chat                 # chat interativo com histórico
ai setup                # configura API key (~/.ai/.env)
```

---

### 2. Workspaces

Cada workspace é um ambiente isolado com sua própria config de LLM, root do projeto e sessões.

```
~/.koda/
├── active                    ← nome do workspace ativo (CLI)
├── config.json               ← config global do app (TTS, STT)
└── workspaces/
    ├── projeto-alpha/
    │   └── config.json       ← LLM CEO + agentes, root do repo
    └── projeto-beta/
        └── config.json
```

**`~/.koda/workspaces/<nome>/config.json`:**
```json
{
  "name": "projeto-alpha",
  "root": "/caminho/para/o/repo",
  "ceo": {
    "provider": "openai-compatible",
    "apiKey": "...",
    "baseURL": "https://api.z.ai/api/coding/paas/v4",
    "model": "glm-5.1",
    "maxTokens": 4096
  },
  "agents": {
    "code":   { "model": "glm-5.1" },
    "review": { "model": "glm-5.1" },
    "git":    { "model": "glm-5.1" }
  },
  "createdAt": "2026-04-24T..."
}
```

**`~/.koda/config.json` — config global do app:**
```json
{
  "tts": {
    "enabled": false,
    "apiKey": "sk-...",
    "voice": "nova",
    "model": "tts-1",
    "speed": 1.0
  },
  "stt": {
    "enabled": false,
    "apiKey": "sk-..."
  }
}
```

**Agentes recebem a config do workspace via variáveis de ambiente** (`LLM_API_KEY`, `LLM_MODEL`, `LLM_BASE_URL`) injetadas no processo filho pelo `MCPClient` — zero mudança nos binários dos agentes.

**Sem workspace ativo:** `koda` usa `~/.ai/.env` (mesmo config do `ai`).

**Comandos de workspace:**
```
koda workspace new           # cria workspace (interativo)
koda workspace list          # lista todos com status
koda workspace use <nome>    # ativa workspace
koda workspace show          # detalhes do workspace ativo
koda workspace delete <nome> # remove workspace
```

**Execução paralela:** cada workspace roda seu próprio CEO + agentes independentemente. Trocar de workspace no Electron não pausa o que está executando.

| Estado | Indicador | Significado |
|---|---|---|
| `idle` | — | Aguardando tarefa |
| `running` | ● (pulsando) | CEO e agentes executando |
| `done` | resumo exibido | Última tarefa concluída |
| `error` | mensagem em vermelho | Falha na execução |

---

### 3. KODA CEO Agent

O orquestrador inteligente. Recebe uma tarefa, avalia, planeja e delega.

**Protocolo de avaliação (antes de criar o plano):**

```
1. Tipo da task:
   investigate → explain/ask (sem mudanças no código)
   modify      → edit/run_task
   verify      → run_command (npm test, lint, build)
   review      → qualidade ou segurança
   ship        → commit/push

2. Complexidade:
   simple   (1-2 steps) → operação única
   moderate (3-4 steps) → editar + verificar, ou review + fix
   complex  (5 steps)   → mudança ampla + testes + review + commit

3. Seleção mínima de agentes:
   - Não usa review/git a menos que a task exija
   - Task simples de edição: code.edit_file → code.run_command
   - Task com qualidade: → adiciona review.review_diff
   - Task para shipar: → adiciona git.commit
```

**Referências de arquivo no texto da task:**
- `@src/auth.ts` (explícito) ou `src/auth.ts` (detectado automaticamente)
- O planner injeta o conteúdo do arquivo no contexto antes de gerar o plano
- Garante que o CEO vê o código antes de decidir o que fazer

**ProgressEvents** — emitidos durante execução para o UI:
```typescript
| { type: 'plan';       plan: CeoPlan }
| { type: 'step_start'; step, index, total }
| { type: 'step_done';  step, index, result }
| { type: 'step_error'; step, index, error }
| { type: 'done';       summary }
```

**LLM:** configurável por workspace. Nenhum provider hardcoded.

**Integração Electron:** `CeoAgent` recebe `agentBinsDir` (caminho para `dist/agents/`) e `projectRoot` em `run()` — resolve diferença de contexto de `__dirname` entre CLI e Electron.

---

### 4. Protocolo MCP

Cada agente especializado roda como um processo separado e expõe suas ferramentas via MCP (stdio transport).

```
CEO (MCP Client)
  └─ connect({ command: 'node', args: ['dist/agents/code.js'], env: { LLM_API_KEY, ... } })
  └─ connect({ command: 'node', args: ['dist/agents/review.js'], env: { ... } })
  └─ connect({ command: 'node', args: ['dist/agents/git.js'], env: { ... } })
```

- Config de LLM por agente injetada via `env` (do workspace)
- Stdout reservado para protocolo MCP — logs vão para stderr
- Agentes são independentes e podem ser usados sem o CEO (Claude Code, outros clientes MCP)

---

### 5. Agentes MCP

#### Code Agent (`src/agents/code.ts`)

| Tool | Args | Descrição |
|---|---|---|
| `ask` | `{ query }` | Pergunta sobre o codebase |
| `edit_file` | `{ file, instruction }` | Edita um arquivo — aplica direto, sem confirmação |
| `explain_file` | `{ file }` | Explica responsabilidades e exports |
| `review_file` | `{ file }` | Review de bugs, performance e manutenibilidade |
| `run_task` | `{ task }` | Planeja e executa task multi-arquivo |
| `run_command` | `{ command }` | Executa comando shell no project root (tester/verifier) |
| `commit` | `{ stage_all? }` | Gera mensagem de commit e commita |

#### Review Agent (`src/agents/review.ts`)

| Tool | Args | Descrição |
|---|---|---|
| `review_file` | `{ file }` | Review estruturado: issues por linha, sugestões, overall |
| `review_diff` | `{ diff? }` | Review do diff staged atual |
| `security_audit` | `{ file }` | Auditoria focada em segurança |

#### Git Agent (`src/agents/git.ts`)

| Tool | Args | Descrição |
|---|---|---|
| `get_status` | `{}` | Status atual do repositório |
| `get_diff` | `{ staged? }` | Diff atual (staged ou unstaged) |
| `commit` | `{ stage_all?, message? }` | Commit — gera mensagem se não fornecida |
| `create_branch` | `{ name }` | Cria e faz checkout de branch |
| `push` | `{ branch?, set_upstream? }` | Push para origin |
| `get_log` | `{ limit? }` | Histórico de commits |

---

### 6. Interface Desktop (Electron)

#### Modos por workspace

Cada workspace no Electron tem dois modos, alternados pelo botão `⚡` no WorkspaceRail:

| Modo | Componente | Descrição |
|---|---|---|
| `chat` | `ChatsPanel` | Chat normal com LLM (agentic ou simples) |
| `koda` | `KodaPanel` | CEO Agent — task input, plan, steps ao vivo |

#### KodaPanel

- **Header:** `KODA` + nível de complexidade do plano + botão Stop
- **Body scrollable:**
  - Estado vazio com instrução
  - Indicador "Planejando..." com spinner
  - Barra de progresso proporcional às steps
  - Abas de agente (code / review / git) quando há mais de um
  - Steps individuais com status (`○` pending → spinner running → `✓` done / `✕` error)
  - Resultado curto por step (< 400 chars)
  - Summary final após conclusão
- **Input:** textarea com Enter para enviar, botão `🎤` para STT, botão `▶` para executar

#### WorkspaceRail

- Botão `⚡` (abaixo do espaço, acima de ⚙) alterna entre modo Chat e KODA para o workspace ativo
- Indicador `●` pulsante no ícone do workspace quando CEO está executando
- Suporte a múltiplos workspaces em execução simultânea

#### Settings — aba ⚡ KODA

Configurações salvas em `~/.koda/config.json` (compartilhado com CLI):

| Campo | Descrição |
|---|---|
| TTS enabled | Liga/desliga voz do CEO |
| TTS API Key | OpenAI API key para síntese de voz |
| Voice | alloy / echo / fable / onyx / nova / shimmer |
| Model | tts-1 (rápido) ou tts-1-hd (alta qualidade) |
| Speed | 0.25× a 4.0× |
| STT enabled | Liga/desliga reconhecimento de voz |
| STT API Key | OpenAI API key para Whisper-1 |

#### IPC Bridge (`electron/preload.ts`)

```typescript
window.api.koda.run(workspaceId, projectRoot, task)     // inicia CEO
window.api.koda.stop(workspaceId)                        // para CEO
window.api.koda.onProgress(cb)                           // escuta ProgressEvents
window.api.koda.onDone(cb)                               // CEO terminou
window.api.koda.off()                                    // remove listeners
window.api.koda.tts(text, config)                        // OpenAI TTS → base64 MP3
window.api.koda.stt(audioBase64)                         // Whisper → transcrição
window.api.koda.getConfig()                              // lê ~/.koda/config.json
window.api.koda.saveConfig(config)                       // salva ~/.koda/config.json
window.api.koda.listWorkspaces()                         // lista koda workspaces
```

---

### 7. Chat com Referências e Comandos

Funciona tanto no `ai chat` (CLI) quanto no `koda` (CEO).

#### `ai chat` — chat normal com o LLM

```bash
# @arquivo — injeta conteúdo do arquivo direto na mensagem
you › explica esse arquivo @src/auth.ts
  Attached: src/auth.ts

# /run <cmd> — executa comando, mostra output e manda para o LLM
you › /run npm test
$ npm test
✓ 12 tests passed, 1 failed
ai › O teste está falhando porque…
```

#### `koda` — CEO Agent

```bash
# @arquivo alimenta o PLANEJAMENTO antes de delegar
koda "review @src/auth.ts and fix the security issues"
→ CEO lê src/auth.ts → planeja → delega para review + code agents

# CEO gera run_command automaticamente para verificar mudanças
koda "fix the failing test in src/auth.ts"
→ plan: code.edit_file → code.run_command("npm test")
```

---

### 8. Camada de LLM

Todos usam o mesmo `LLMProvider` de `src/llm/provider.ts` — configurável, sem hardcode.

```
CEO Agent    → LLMProvider(workspace.ceo)          → qualquer LLM
Code Agent   → LLMProvider(workspace.agents.code)  → qualquer LLM
Review Agent → LLMProvider(workspace.agents.review)→ qualquer LLM
Git Agent    → LLMProvider(workspace.agents.git)   → qualquer LLM
```

Providers suportados (OpenAI-compatible):
- z.ai / GLM (default)
- OpenAI, Groq, Ollama, qualquer endpoint compatível

Para Anthropic: adicionar provider type em `src/llm/provider.ts`.

---

## Roadmap de Fases

| Fase | Descrição | Status |
|---|---|---|
| **1 — MCP Foundation** | `@modelcontextprotocol/sdk`, `src/mcp/server.ts`, `src/mcp/client.ts` | ✅ Concluída |
| **2 — CEO Agent** | `src/ceo/`, planner, orquestrador, `koda` CLI | ✅ Concluída |
| **3 — Agentes MCP** | Code, Review e Git Agents como MCP Servers | ✅ Concluída |
| **4 — Workspace System** | `src/workspace/`, `~/.koda/`, `koda workspace` | ✅ Concluída |
| **4.1 — CEO Inteligente** | Avaliação de complexidade, `run_command`, referências `@arquivo` | ✅ Concluída |
| **5 — Interface Desktop** | KodaPanel, WorkspaceRail ●, Settings KODA, TTS/STT, IPC bridge | ✅ Concluída |
| **6 — Melhorias Futuras** | Autocomplete de @arquivo no input, histórico de tasks por workspace, streaming do output dos agentes em tempo real | 🔲 Futura |

---

## Decisões de Arquitetura

| Decisão | Escolha | Razão |
|---|---|---|
| Protocolo inter-agentes | MCP (stdio) | Padrão de mercado, compatível com Claude Code |
| LLM do CEO e agentes | Configurável por workspace | Usuário escolhe; nenhum provider hardcoded |
| Config por agente | Env vars injetadas no subprocesso | Zero mudança nos binários dos agentes |
| Isolamento | Workspace individual em `~/.koda/` | Cada projeto tem LLM, root e sessões próprios |
| Visibilidade | ProgressEvents + steps ao vivo no KodaPanel | Usuário acompanha cada agente em tempo real |
| Seleção de agentes | CEO avalia complexidade e usa o mínimo | Evita overhead para tasks simples |
| Stdout nos agentes | Reservado ao protocolo MCP; logs no stderr | Não corrompe o protocolo MCP |
| Retrocompatibilidade | `ai` CLI nunca modificado | CEO é camada adicional, não substituta |
| agentBinsDir no CeoAgent | Parâmetro opcional no constructor | Resolve diferença de `__dirname` entre CLI e Electron |
| TTS/STT config | `~/.koda/config.json` — nível de app | Preferência do usuário, não do projeto; compartilhada com CLI |
| STT provider | OpenAI Whisper via main process | Mais preciso que Web Speech API; suporta PT e multilíngue |
| TTS provider | OpenAI TTS via main process | Qualidade e naturalidade superiores ao Web Speech API |
| Modo KODA no Electron | Botão ⚡ no WorkspaceRail, por workspace | Cada workspace tem seu modo independente |
| Runtime | Node.js ESM | Já usado no projeto |
| UI | Electron + React | Desktop app já construído |
