# Koda

Desktop app e CLI de AI para desenvolvimento. Entende o seu codebase completo via contexto de projeto e funciona com qualquer LLM compatível com a API OpenAI — GLM, OpenAI, Groq, Ollama e outros.

---

## Desktop App

```bash
npm install
npm run desktop        # modo dev
npm run dist:mac       # build .dmg para macOS
```

### Layout

```
┌──────┬──────────────────────┬──────────────────────────────────┐
│      │                      │  Editor │ Browser │ Git          │
│      │   Chat / KODA        │──────────────────────────────────│
│ Rail │   (painel esquerdo)  │                                  │
│      │                      │   Conteúdo da aba ativa          │
│      │                      │                                  │
└──────┴──────────────────────┴──────────────────────────────────┘
```

A largura do painel esquerdo é ajustável via drag (220px – 640px).

---

### WorkspaceRail

Barra vertical à esquerda com navegação entre workspaces.

| Elemento | Ação |
|---|---|
| Círculo com iniciais | Alterna workspace ativo |
| Badge com número | Quantidade de chats no workspace |
| Ponto pulsante verde | CEO agent em execução neste workspace |
| `+` | Cria novo workspace |
| `⚡` | Alterna modo Chat ↔ KODA no workspace ativo |
| `⚙` | Abre Settings |

---

### Painel Chat

Chat conversacional por workspace. Cada workspace suporta múltiplas sessões independentes, salvas em `.koda/chats.json` na raiz do projeto.

**Por sessão de chat:**
- Seletor de modelo individual (provider ou agente customizado)
- Dois modos de envio: **Chat** (histórico contínuo) e **Ask** (pergunta avulsa sem contexto)
- Streaming de respostas em tempo real com indicador dinâmico ("Pensando…", "Trabalhando…", "Gerando resposta…")
- Contexto do codebase injetado automaticamente em cada mensagem

**Modo Agentic (Claude):**
- Blocos de *thinking* expansíveis com tempo de raciocínio
- Blocos de tool use em tempo real: `Read`, `Write`, `Run`, `Search`, `List`
- Summary automático ao final: `✎ arquivos modificados`, `⚡ comandos`, `📄 leituras`, `🔍 buscas`

**Ações no chat:**
- `Enter` → envia mensagem; `Shift+Enter` → nova linha
- `■` → interrompe streaming
- Botões no header do arquivo aberto: **Explain**, **Review**, **Edit (AI)** — disparam ações direto no chat ativo

---

### Painel KODA

CEO agent integrado ao desktop. Toggle por workspace via `⚡` na WorkspaceRail.

**Fluxo manual:**

1. Digite a tarefa no input (ex: `"revisa src/auth.ts, corrige os bugs e commita"`)
2. O CEO gera um plano com complexidade indicada (`simple` / `moderate` / `complex`) e raciocínio
3. Revise e clique **Executar** para confirmar
4. Steps executados em sequência: agente → tool → resultado → próximo step
5. Summary ao finalizar; botão **Nova tarefa** para recomeçar

**Fluxo por voz:**

1. Clique no orb `⚡` para ativar — diga **"KODA"** para acordar
2. Diga a tarefa → transcrição automática via Whisper
3. Plano gerado e lido em voz (TTS) — diga **"sim"** para executar ou **"não"** para cancelar
4. Summary lido em voz ao concluir; volta a aguardar o próximo comando

**Estados do orb:** `Aguardando "KODA"…` → `Ouvindo…` → `Transcrevendo…` → `Gerando plano…` → `Diga sim ou não…` → `Executando…`

**Funcionalidades:**
- Abas por agente (`code` / `review` / `git`) para filtrar steps
- Status por step: `○` pendente → spinner → `✓` concluído / `✕` erro
- Barra de progresso (steps concluídos / total)
- **Stop** para interromper a qualquer momento
- **Histórico** — lista de execuções anteriores com steps, resultados e summary, por projeto

---

### Aba Editor

Divide-se em duas colunas: **File Tree** (esquerda) e **Editor** (direita).

**File Tree:**
- Expandir/colapsar pastas (clique no `▸`)
- Badge colorida por tipo de arquivo (TS, JS, PY, JSON, MD, CSS, GO, RS, SQL, YAML, etc.)
- Coloração Git no nome do arquivo: verde (Added), amarelo (Modified), vermelho (Deleted), rosa (Renamed), cinza (Untracked)
- Ponto branco `•` se o arquivo tem alterações não salvas
- Double-click → rename inline (Enter confirma, Escape cancela)
- Botão `↺` para refresh da árvore

**Editor:**
- CodeMirror 6 com tema Dracula, line numbers, fold gutter, autocomplete, highlight de seleção
- Syntax highlighting automático por extensão (15+ linguagens)
- `Cmd+S` ou botão **Save** para salvar
- Botão **Explain** → envia explicação do arquivo para o chat ativo
- Botão **Review** → envia code review para o chat ativo
- Botão **Edit (AI)** → abre prompt de instrução no chat para editar o arquivo via IA
- Preview para arquivos de imagem (PNG, JPG, etc.)
- Múltiplas abas abertas simultaneamente

---

### Aba Browser

Executa o servidor de desenvolvimento e exibe o preview embutido.

| Elemento | Descrição |
|---|---|
| Campo de comando | Comando a executar (padrão: `npm run dev`) |
| **Run** / **Stop** | Inicia ou encerra o processo |
| `⊟` | Mostra/oculta o terminal de output |
| Campo de URL | URL do preview (padrão: `http://localhost:3000`) |
| **Go** | Navega para a URL |
| Terminal | stdout/stderr do processo com auto-scroll e auto-detect de porta |
| iframe | Preview da aplicação em execução |

A porta é detectada automaticamente a partir do output (`localhost:PORT`) e o preview atualiza sozinho.

---

### Aba Git

| Seção | Funcionalidades |
|---|---|
| **Branch** | Dropdown para listar e trocar branches; `↓ Pull` e `↑ Push` |
| **Changes** | Lista de arquivos com status (M/A/D/R/U); checkbox para stage/unstage; `↩` para descartar alterações |
| **Commit** | Textarea para a mensagem; `✨ Generate with AI` para gerar via LLM; botão **Commit** |
| **Recent commits** | Lista com hash e mensagem; clique para ver o diff do commit |
| **Diff viewer** | Diff colorido do arquivo ou commit selecionado (verde = add, vermelho = remove) |

---

### DiffModal

Abre automaticamente quando o agente propõe uma edição em arquivo via chat.

- Exibe diff colorido (linhas adicionadas em verde, removidas em vermelho)
- **Accept changes** → aplica a edição no arquivo
- **Reject** → descarta a edição
- Clique fora do modal → descarta

---

### Settings

Aberto via `⚙` na WorkspaceRail. Três abas:

#### AI Providers

Gerencia os providers de LLM disponíveis no app. No topo da aba ficam as integrações com autenticação própria; abaixo, os providers configurados manualmente.

---

##### Claude Code

Detecta automaticamente a conta logada no **Claude Desktop** ou no **Claude Code CLI**, lendo as credenciais de `~/.claude.json`. Não exige API key — usa o OAuth token da conta existente.

- Se conectado: exibe nome, email e plano da conta
- Se desconectado: exibe instruções para fazer login (`claude login`)
- **Troca de conta em tempo real**: quando a conta é trocada no Claude Desktop (logout → login com outra conta), o KODA detecta a mudança em `~/.claude.json` e atualiza o provider automaticamente — sem fechar o app
- Provider gerado automaticamente: `claude-code` com `baseUrl: https://api.anthropic.com`
- Modelos disponíveis: `claude-opus-4-7`, `claude-sonnet-4-6`, `claude-haiku-4-5-20251001`
- Credenciais salvas em `~/.koda/copilot-auth.json`

---

##### GitHub Copilot

Autentica com GitHub via **OAuth Device Flow** — sem API key, sem CLI.

**Fluxo de conexão:**
1. Clique **Conectar com GitHub** — o browser abre automaticamente em `github.com/login/device`
2. Insira o código exibido no app (formato `XXXX-XXXX`)
3. Clique **Já autorizei, continuar** — o app detecta a autorização e salva o token
4. Provider `github-copilot` é criado automaticamente

**Detalhes:**
- Requer assinatura ativa do GitHub Copilot (Individual, Business ou Enterprise)
- Token Copilot é renovado automaticamente antes de cada chamada (tokens têm validade ~30 min)
- Credenciais salvas em `~/.koda/copilot-auth.json`
- Botão ✕ desconecta e remove o provider; para trocar de conta GitHub basta conectar novamente
- Modelos disponíveis via Copilot: `gpt-4o`, `gpt-4o-mini`, `o3-mini`, `claude-3.5-sonnet`, `claude-3.7-sonnet`, `gemini-2.0-flash`

---

##### Providers manuais

Providers padrão incluídos: OpenAI, Anthropic, Google Gemini, GLM/ZhipuAI.

Por provider:
- Nome (editável)
- API Key (campo senha)
- Base URL
- Models (lista separada por vírgula)
- Toggle **Enabled**
- Botão para remover

Botão **+ Add Provider** para adicionar providers customizados. Configurações salvas em `localStorage`.

#### Agents

Agentes customizados com system prompt próprio, disponíveis como opção de modelo no seletor do chat.

Agentes padrão incluídos: Code Reviewer, Code Explainer, Refactor Pro, Test Writer, Software Engineer, Documentation Writer, Debug Detective, Security Analyst, Project Analyst.

Por agente:
- Nome
- Modelo (dropdown dos providers habilitados)
- System Prompt (textarea) + botão `✦ Generate with AI` para gerar via LLM
- Skills (lista separada por vírgula)

Botões **+ New Agent**, **Edit** e **Delete**. Configurações salvas em `localStorage`.

#### ⚡ KODA

Configurações compartilhadas com o CLI, salvas em `~/.koda/config.json`.

**Model Routing** — modelo por agente CEO:

| Agente | Configuração |
|---|---|
| Code Agent | Provider + Model |
| Review Agent | Provider + Model |
| Git Agent | Provider + Model |

**Text-to-Speech (TTS):**
- Toggle Enabled
- API Key (OpenAI)
- Voz: `alloy`, `echo`, `fable`, `onyx`, `nova`, `shimmer`
- Modelo: `tts-1` (rápido) ou `tts-1-hd` (alta qualidade)
- Velocidade: 0.25× a 4.0×

**Speech-to-Text (STT):**
- Toggle Enabled
- API Key (OpenAI — usa Whisper-1)

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

| Provedor | BASE_URL | Modelo | Auth |
|---|---|---|---|
| OpenAI | `https://api.openai.com/v1` | `gpt-4o` | API key |
| Anthropic | `https://api.anthropic.com` | `claude-sonnet-4-6` | API key |
| GitHub Copilot | `https://api.githubcopilot.com` | `gpt-4o`, `claude-3.7-sonnet`, … | OAuth (app) |
| Claude Code | `https://api.anthropic.com` | `claude-opus-4-7`, … | OAuth (Claude Desktop) |
| Z.ai (GLM) | `https://api.z.ai/api/coding/paas/v4` | `glm-5.1` | API key |
| Groq | `https://api.groq.com/openai/v1` | `llama-3.1-70b-versatile` | API key |
| Ollama (local) | `http://localhost:11434/v1` | `llama3.2` | — |

---

## CLI

```bash
npm run link    # instala o comando `koda` globalmente
koda setup      # configura API key e modelo
```

### Agente principal

Os comandos individuais usam um agente único que seleciona automaticamente os arquivos mais relevantes do projeto e os injeta como contexto antes de cada chamada ao LLM. Histórico de sessão mantido por projeto (últimas 6 trocas).

```bash
koda ask "como funciona o sistema de autenticação?"
koda edit src/api/checkout.ts -i "adicionar validação de input"
koda review src/api/users.ts
koda explain src/core/agent.ts
koda commit
koda run "adicionar middleware de autenticação JWT"
```

### Chat interativo

```bash
koda chat          # retoma a sessão anterior do projeto
koda chat --new    # nova sessão, limpa histórico
```

Comandos disponíveis dentro do chat:

| Comando | O que faz |
|---|---|
| `/clear` | Limpa o histórico da sessão atual |
| `/model <nome>` | Troca o modelo LLM sem sair do chat |
| `/context` | Exibe o conteúdo do `.aicontext` carregado |
| `/history` | Mostra quantas trocas há na sessão |
| `/run <cmd>` | Executa um comando shell e envia o output ao LLM |
| `/exit` | Encerra o chat |
| `@src/arquivo.ts` | Anexa o conteúdo do arquivo à mensagem |

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
  copilot-auth.ts       → OAuth Device Flow do GitHub Copilot (token store em ~/.koda/copilot-auth.json)
  claude-code-auth.ts   → leitura de credenciais do Claude Code (~/.claude.json) + watcher de conta
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
