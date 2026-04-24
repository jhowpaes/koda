import type { Agent } from '../core/agent.js';
import { buildFileContext } from '../context/builder.js';

const EXPLAIN_PROMPT = `You are an expert software engineer. Explain what this file does clearly and concisely.

Format your response as:

## <filename>

<1-2 sentence summary of what this file does>

### Responsibilities
- <key responsibility>

### Key exports / functions
- <name>: <what it does>

### Dependencies
- <what it imports and why>

Keep it short. Respond in the same language as the file comments/docs.`;

export async function explainFile(agent: Agent, filePath: string): Promise<void> {
  const fileContext = buildFileContext(filePath);
  await agent.callWithSystemPrompt(EXPLAIN_PROMPT, `Explain this file:\n\n${fileContext}`);
}
