import type { Agent } from '../core/agent.js';
import { buildFileContext } from '../context/builder.js';

const REVIEW_PROMPT = `You are a senior code reviewer. Analyze the file and provide a structured review.

Format your response as:

## Code Review: <filename>

### Issues
- [L<line>] <description> — <severity: critical/warning/suggestion>

### Suggestions
- <improvement suggestion>

### Overall
<1-2 sentence summary>

Be concise. Focus on real problems: bugs, security, performance, maintainability.
Respond in the same language as the file comments/docs.`;

export async function reviewFile(agent: Agent, filePath: string): Promise<void> {
  const fileContext = buildFileContext(filePath);
  await agent.callWithSystemPrompt(REVIEW_PROMPT, `Review this file:\n\n${fileContext}`);
}
