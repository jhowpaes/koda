# Contributing to Koda

## Getting started

```bash
git clone https://github.com/your-org/koda.git
cd koda
npm install
cp .env.example .env   # fill in your LLM_API_KEY
npm run desktop        # start Electron dev mode
```

## Project structure

```
electron/        Electron main process and preload bridge
src/
  cli/           CLI entry point (bin/ai and bin/koda)
  ceo/           CEO Agent — orchestrates sub-agents via MCP
  agents/        Specialized agents (code, review, git)
  llm/           OpenAI-compatible provider adapter
  context/       Project context builder (heuristic file selection)
  workspace/     Workspace and session management
build/           Icons and macOS notarization hook
```

## LLM configuration

Koda works with any OpenAI-compatible provider. Set `LLM_BASE_URL` and `LLM_MODEL` in your `.env` — no code changes needed.

## Submitting changes

1. Fork and create a branch from `main`
2. Make your changes, keeping commits focused and atomic
3. Open a pull request with a clear description of what and why
4. Ensure the desktop app starts without errors (`npm run desktop`)

## Reporting issues

Open a GitHub Issue with:
- OS and Node.js version
- Steps to reproduce
- Expected vs actual behavior

## License

By contributing you agree your code will be released under the [MIT License](LICENSE).
