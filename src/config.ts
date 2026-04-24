import dotenv from 'dotenv';
import path from 'path';
import os from 'os';
import { loadProjectConfig } from './context/project.js';

// global config: ~/.ai/.env  (where the API key lives)
dotenv.config({ path: path.join(os.homedir(), '.ai', '.env') });
// local .env overrides (useful during development of code-ai itself)
dotenv.config();

const projectConfig = loadProjectConfig();

export const config = {
  apiKey: process.env.LLM_API_KEY ?? '',
  baseURL: projectConfig.baseURL ?? process.env.LLM_BASE_URL ?? 'https://api.z.ai/api/coding/paas/v4',
  model: projectConfig.model ?? process.env.LLM_MODEL ?? 'glm-5.1',
  maxTokens: projectConfig.maxTokens ?? parseInt(process.env.LLM_MAX_TOKENS ?? '4096'),
  contextBudget: projectConfig.contextBudget ?? parseInt(process.env.CONTEXT_BUDGET ?? '12000'),
};

