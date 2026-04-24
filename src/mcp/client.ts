// MCP Client — used by the CEO Agent (Phase 2) to connect to specialized agent servers.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export interface AgentConfig {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;  // injected into the agent subprocess — used for workspace LLM config
}

export class MCPClient {
  private clients = new Map<string, Client>();

  async connect(agent: AgentConfig): Promise<void> {
    const client = new Client(
      { name: 'koda-ceo', version: '1.0.0' },
      { capabilities: {} }
    );
    const transport = new StdioClientTransport({
      command: agent.command,
      args: agent.args,
      env: agent.env ? { ...process.env, ...agent.env } as Record<string, string> : undefined,
    });
    await client.connect(transport);
    this.clients.set(agent.name, client);
  }

  async callTool(agentName: string, toolName: string, args: Record<string, unknown>): Promise<string> {
    const client = this.clients.get(agentName);
    if (!client) throw new Error(`Agent not connected: ${agentName}`);
    const result = await client.callTool({ name: toolName, arguments: args });
    const content = result.content as Array<{ type: string; text?: string }>;
    const first = content[0];
    if (!first || first.type !== 'text') return '';
    return first.text ?? '';
  }

  async listTools(agentName: string) {
    const client = this.clients.get(agentName);
    if (!client) throw new Error(`Agent not connected: ${agentName}`);
    return client.listTools();
  }

  async disconnect(agentName: string): Promise<void> {
    const client = this.clients.get(agentName);
    if (client) {
      await client.close();
      this.clients.delete(agentName);
    }
  }

  async disconnectAll(): Promise<void> {
    await Promise.all([...this.clients.keys()].map(n => this.disconnect(n)));
  }
}
