export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMRequest {
  messages: Message[];
  maxTokens?: number;
}

export interface LLMResponse {
  content: string;
  usage?: { prompt: number; completion: number };
}

export interface LLMProvider {
  complete(req: LLMRequest): Promise<LLMResponse>;
  stream(req: LLMRequest, onChunk: (chunk: string) => void): Promise<void>;
}
