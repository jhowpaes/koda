import { defineConfig } from 'tsup';

export default defineConfig([
  // CLI — comportamento original inalterado
  {
    entry: ['src/cli/index.ts'],
    format: ['esm'],
    outDir: 'dist',
    splitting: false,
    clean: true,
    banner: { js: '#!/usr/bin/env node' },
  },
  // MCP Agents — servidores para o CEO orquestrar
  {
    entry: ['src/agents/code.ts', 'src/agents/review.ts', 'src/agents/git.ts'],
    format: ['esm'],
    outDir: 'dist/agents',
    splitting: false,
    clean: false,
  },
  // CEO Agent CLI — entry de teste (koda "task")
  {
    entry: ['src/ceo/cli.ts'],
    format: ['esm'],
    outDir: 'dist/ceo',
    splitting: false,
    clean: false,
    banner: { js: '#!/usr/bin/env node' },
  },
]);
