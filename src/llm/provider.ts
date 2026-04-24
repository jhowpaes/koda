import OpenAI from 'openai';
import type { LLMProvider, LLMRequest, LLMResponse } from './types.js';

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function createProvider(config: {
  apiKey: string;
  baseURL: string;
  model: string;
  maxTokens: number;
}): LLMProvider {
  const client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL });
  const { model, maxTokens } = config;

  return {
    async complete(req: LLMRequest): Promise<LLMResponse> {
      const res = await client.chat.completions.create({
        model,
        messages: req.messages,
        max_tokens: req.maxTokens ?? maxTokens,
        stream: false,
      });
      return {
        content: res.choices[0]?.message?.content ?? '',
        usage: res.usage
          ? { prompt: res.usage.prompt_tokens, completion: res.usage.completion_tokens }
          : undefined,
      };
    },

    async stream(req: LLMRequest, onChunk: (chunk: string) => void): Promise<void> {
      const stream = await client.chat.completions.create({
        model,
        messages: req.messages,
        max_tokens: req.maxTokens ?? maxTokens,
        stream: true,
      });
      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content;
        if (content) onChunk(content);
      }
    },
  };
}
