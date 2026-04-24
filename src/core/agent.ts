import type { LLMProvider, Message } from '../llm/types.js';
import { getCached, setCached } from '../llm/cache.js';
import { buildContext, buildFileContext, buildSystemPrompt } from '../context/builder.js';
import { loadSession, saveSession } from './session-store.js';
import { projectRoot } from '../utils/git.js';
import chalk from 'chalk';

const BASE_SYSTEM_PROMPT = `You are an expert software engineer assistant working in a codebase.
Be concise and precise. Respond in the same language the user writes.
When asked to edit a file, return the COMPLETE modified file content inside a single fenced code block.
Do not explain what you are about to do — just do it.`;

const MAX_HISTORY_TURNS = 6;

export class Agent {
  private history: Message[] = [];
  private currentModel: string;

  constructor(private provider: LLMProvider, private model: string) {
    this.currentModel = model;
    const session = loadSession(projectRoot());
    if (session?.messages.length) this.history = session.messages;
  }

  setModel(model: string) { this.currentModel = model; }
  getHistory(): Message[] { return this.history; }

  clearHistory(): void {
    this.history = [];
    saveSession(projectRoot(), [], this.currentModel);
  }

  async ask(query: string, budgetTokens = 8000, onChunk?: (c: string) => void): Promise<string> {
    const context = buildContext(query, budgetTokens);
    const content = context ? `${query}\n\nRelevant code:\n${context}` : query;
    return this.callOnce(content, onChunk);
  }

  async edit(filePath: string, instruction: string, onChunk?: (c: string) => void): Promise<string> {
    const fileContext = buildFileContext(filePath);
    const content = `${instruction}\n\nFile to edit:\n${fileContext}`;
    return this.callOnce(content, onChunk);
  }

  async editSilent(filePath: string, instruction: string): Promise<string> {
    const fileContext = buildFileContext(filePath);
    const content = `${instruction}\n\nFile to edit:\n${fileContext}`;
    const sysPrompt = buildSystemPrompt(BASE_SYSTEM_PROMPT);
    const messages: Message[] = [
      { role: 'system', content: sysPrompt },
      { role: 'user', content },
    ];
    const res = await this.provider.complete({ messages });
    return res.content;
  }

  async chat(userMessage: string, onChunk?: (c: string) => void): Promise<string> {
    const context = buildContext(userMessage, 6000);
    const content = context ? `${userMessage}\n\nRelevant code:\n${context}` : userMessage;

    this.history.push({ role: 'user', content });
    if (this.history.length > MAX_HISTORY_TURNS * 2) {
      this.history = this.history.slice(-MAX_HISTORY_TURNS * 2);
    }

    const sysPrompt = buildSystemPrompt(BASE_SYSTEM_PROMPT);
    const messages: Message[] = [{ role: 'system', content: sysPrompt }, ...this.history];

    let response = '';
    await this.provider.stream({ messages }, chunk => {
      if (onChunk) onChunk(chunk); else process.stdout.write(chunk);
      response += chunk;
    });
    if (!onChunk) process.stdout.write('\n');

    this.history.push({ role: 'assistant', content: response });
    saveSession(projectRoot(), this.history, this.currentModel);
    return response;
  }

  async callWithSystemPrompt(sysPrompt: string, userContent: string, onChunk?: (c: string) => void): Promise<string> {
    const fullSys = buildSystemPrompt(sysPrompt);
    const messages: Message[] = [
      { role: 'system', content: fullSys },
      { role: 'user', content: userContent },
    ];
    let response = '';
    await this.provider.stream({ messages }, chunk => {
      if (onChunk) onChunk(chunk); else process.stdout.write(chunk);
      response += chunk;
    });
    if (!onChunk) process.stdout.write('\n');
    return response;
  }

  async callWithSystemPromptSilent(sysPrompt: string, userContent: string): Promise<string> {
    const messages: Message[] = [
      { role: 'system', content: sysPrompt },
      { role: 'user', content: userContent },
    ];
    const res = await this.provider.complete({ messages });
    return res.content;
  }

  private async callOnce(userContent: string, onChunk?: (c: string) => void): Promise<string> {
    const cached = getCached(userContent);
    if (cached) {
      if (!onChunk) { console.log(chalk.dim('(from cache)\n')); process.stdout.write(cached + '\n'); }
      return cached;
    }
    const sysPrompt = buildSystemPrompt(BASE_SYSTEM_PROMPT);
    const messages: Message[] = [
      { role: 'system', content: sysPrompt },
      { role: 'user', content: userContent },
    ];
    let response = '';
    await this.provider.stream({ messages }, chunk => {
      if (onChunk) onChunk(chunk); else process.stdout.write(chunk);
      response += chunk;
    });
    if (!onChunk) process.stdout.write('\n');
    setCached(userContent, response);
    return response;
  }
}
