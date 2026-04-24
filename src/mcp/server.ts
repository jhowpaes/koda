import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

export type ToolHandler = (args: Record<string, unknown>) => Promise<string>;

export interface MCPTool {
  definition: {
    name: string;
    description: string;
    inputSchema: {
      type: 'object';
      properties?: Record<string, unknown>;
      required?: string[];
    };
  };
  handler: ToolHandler;
}

export function createMCPServer(name: string, version: string, tools: MCPTool[]) {
  const server = new Server({ name, version }, { capabilities: { tools: {} } });
  const toolMap = new Map(tools.map(t => [t.definition.name, t.handler]));

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map(t => t.definition),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const handler = toolMap.get(request.params.name);
    if (!handler) {
      return {
        content: [{ type: 'text' as const, text: `Unknown tool: ${request.params.name}` }],
        isError: true,
      };
    }
    try {
      const result = await handler((request.params.arguments ?? {}) as Record<string, unknown>);
      return { content: [{ type: 'text' as const, text: result }] };
    } catch (err) {
      return {
        content: [{ type: 'text' as const, text: String(err) }],
        isError: true,
      };
    }
  });

  return {
    async start(): Promise<void> {
      const transport = new StdioServerTransport();
      await server.connect(transport);
    },
  };
}
