import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider, LLMRequest, LLMResponse } from './types.js';

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function createProvider(config: {
  provider?: 'openai-compatible' | 'anthropic';
  apiKey: string;
  baseURL?: string;
  model: string;
  maxTokens: number;
}): LLMProvider {
  if (config.provider === 'anthropic') {
    return createAnthropicProvider(config);
  }
  return createOpenAIProvider(config as { apiKey: string; baseURL: string; model: string; maxTokens: number });
}

function createOpenAIProvider(config: {
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

function createAnthropicProvider(config: {
  apiKey: string;
  model: string;
  maxTokens: number;
}): LLMProvider {
  const client = new Anthropic({ apiKey: config.apiKey });
  const { model, maxTokens } = config;

  return {
    async complete(req: LLMRequest): Promise<LLMResponse> {
      const system = req.messages.find(m => m.role === 'system')?.content;
      const messages = req.messages
        .filter(m => m.role !== 'system')
        .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

      const res = await client.messages.create({
        model,
        max_tokens: req.maxTokens ?? maxTokens,
        ...(system ? { system } : {}),
        messages,
      });

      const content = res.content.find(b => b.type === 'text')?.text ?? '';
      return {
        content,
        usage: { prompt: res.usage.input_tokens, completion: res.usage.output_tokens },
      };
    },

    async stream(req: LLMRequest, onChunk: (chunk: string) => void): Promise<void> {
      const system = req.messages.find(m => m.role === 'system')?.content;
      const messages = req.messages
        .filter(m => m.role !== 'system')
        .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

      const stream = client.messages.stream({
        model,
        max_tokens: req.maxTokens ?? maxTokens,
        ...(system ? { system } : {}),
        messages,
      });

      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          onChunk(event.delta.text);
        }
      }
    },
  };
}
