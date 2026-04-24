# Koda

Desktop app de AI para desenvolvimento. Entende o seu codebase completo via contexto de projeto e funciona com qualquer LLM compatível com a API OpenAI — GLM, OpenAI, Ollama e outros.

---

## Desktop App

```bash
npm install
npm run desktop        # modo dev
npm run dist:mac       # build .dmg para macOS
```

### Funcionalidades

| Painel | O que faz |
|---|---|
| **Editor** | CodeMirror 6, syntax highlighting para 15+ linguagens, salvar com `Cmd+S` |
| **Browser** | Roda o servidor do projeto embutido, auto-detecta porta, terminal colapsável |
| **Git** | Stage/unstage, diff inline, commit com geração de mensagem via IA, push/pull |
| **Chat** | Histórico de sessão persistente por projeto, contexto do codebase injetado automaticamente |

---

## Como o contexto funciona

Ao abrir um projeto, o Koda:

1. Detecta a raiz via `.git`
2. Seleciona os arquivos mais relevantes por busca heurística de keywords
3. Injeta o `.aicontext` do projeto (se existir) em todo request

Isso significa que o chat e os comandos entendem o projeto inteiro, não só o arquivo aberto.

---

## Configuração

### Variáveis de ambiente (`~/.ai/.env`)

```env
LLM_API_KEY=sua_chave_aqui
LLM_BASE_URL=https://api.z.ai/api/coding/paas/v4
LLM_MODEL=glm-5.1
LLM_MAX_TOKENS=4096
CONTEXT_BUDGET=12000
```

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

Sobrescreve o modelo para um projeto específico. A API key nunca vai aqui.

```json
{
  "model": "glm-5.1",
  "maxTokens": 4096,
  "contextBudget": 12000
}
```

---

## Suporte a LLMs

Qualquer provedor com API compatível com OpenAI funciona via `LLM_BASE_URL`:

| Provedor | BASE_URL | Modelo |
|---|---|---|
| Z.ai (GLM) | `https://api.z.ai/api/coding/paas/v4` | `glm-5.1` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o` |
| Groq | `https://api.groq.com/openai/v1` | `llama-3.1-70b-versatile` |
| Ollama (local) | `http://localhost:11434/v1` | `llama3.2` |

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
  main.ts               → processo principal Electron
  preload.ts            → bridge main ↔ renderer
  renderer/             → React app (UI)

src/
  cli/index.ts          → comandos CLI (ask, edit, review, commit, run, chat, setup)
  core/
    agent.ts            → orquestrador principal
    session-store.ts    → histórico persistente por projeto (~/.ai-sessions/)
  llm/
    provider.ts         → adapter OpenAI-compatible
    cache.ts            → cache de respostas (~/.ai-cache/)
  context/
    builder.ts          → seleção heurística de arquivos por keyword
    project.ts          → lê .aicontext, package.json, estrutura do projeto
  commands/
    review.ts           → code review
    explain.ts          → explicação de arquivo
    commit.ts           → geração de mensagem de commit
    run.ts              → agente autônomo com plano + confirmação

build/
  icon.svg              → ícone fonte (vetorial)
  icon.icns             → macOS (gerado via npm run gen-icon)
  icon.ico              → Windows (gerado via npm run gen-icon)
  icon.png              → Linux / electron-builder (gerado via npm run gen-icon)
  scripts/gen-icon.sh   → script de geração dos ícones
```

---

## Roadmap

Ver [ROADMAP.md](./ROADMAP.md) para o plano completo de evolução.

---

## CLI (bônus)

O Koda também funciona como CLI em qualquer projeto via `ai`:

```bash
npm run link           # instala o comando `ai` globalmente
ai setup               # configura API key e modelo

ai ask "como funciona o sistema de pagamentos?"
ai edit src/api/checkout.ts -i "adicionar validação de input"
ai review src/api/users.ts
ai commit
ai run "adicionar middleware de autenticação JWT"
ai chat
```
