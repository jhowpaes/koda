export interface LLMConfig {
  provider: 'openai-compatible' | 'anthropic';
  apiKey: string;
  baseURL?: string;  // required for openai-compatible, unused for anthropic
  model: string;
  maxTokens?: number;
}

export interface WorkspaceConfig {
  name: string;
  root: string;       // absolute path to the project root
  ceo: LLMConfig;     // LLM used by the CEO Agent
  agents: {
    code?:   Partial<LLMConfig>;  // overrides ceo config if set
    review?: Partial<LLMConfig>;
    git?:    Partial<LLMConfig>;
  };
  createdAt: string;  // ISO date
}

// Resolved config for a single agent — merges workspace.ceo defaults with agent overrides
export interface ResolvedAgentConfig {
  provider: 'openai-compatible' | 'anthropic';
  apiKey: string;
  baseURL?: string;
  model: string;
  maxTokens: number;
}
