import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { REPLTool } from './REPLTool.js';
import { TaskCreateTool } from './TaskCreateTool.js';
import { RememberTool, RecallTool } from './RememberTool.js';
import { BatchTool } from './BatchTool.js';
import { LoopTool } from './LoopTool.js';

/**
 * AgentBoard Native MCP Server
 * This process is spawned dynamically per-agent session.
 * It hosts all high-level capabilities (LSP, Task Orchestration).
 */

const userId = process.argv[2] || process.env.USER_ID || 'default';
const sessionId = process.argv[3] || process.env.SESSION_ID || 'unknown';

const server = new Server(
  {
    name: 'agentboard-native-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

// Instantiate all active tools
const activeTools = [
  new REPLTool(),
  new TaskCreateTool(),
  new RememberTool(),
  new RecallTool(),
  new BatchTool(),
  new LoopTool(),
];

// Register Tool List
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: activeTools.map((t) => t.getToolDef()),
  };
});

// Handle Tool Execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    const tool = activeTools.find((t) => t.name === name);
    if (!tool) {
      throw new Error(`Unknown tool: ${name}`);
    }

    const context = { userId, sessionId, userWorkspace: process.env.HOME || '/tmp' };

    // Quick hack for userWorkspace mapping in child processes.
    // In advanced production scenarios, we might pass userWorkspace explicitly as arg 4.
    // For now, since agentManager runs this, it inherits the environment! Wait. NO.
    // We should pass workspace dir directly.
    return await tool.call(args, context);
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `[Internal Orchestration Error executing ${name}]\n${error.message}`,
        },
      ],
      isError: true,
    };
  }
});

// Start the server via STDIO
const transport = new StdioServerTransport();
server.connect(transport).catch(console.error);
