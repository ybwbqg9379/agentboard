import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { REPLTool } from './REPLTool.js';
import { TaskCreateTool } from './TaskCreateTool.js';
import { RememberTool, RecallTool } from './RememberTool.js';
import { BatchTool } from './BatchTool.js';
import { LoopTool } from './LoopTool.js';
import { LSPTool } from './LSPTool.js';
import { VisualizerTool } from './VisualizerTool.js';
import { DataAnalystTool } from './DataAnalystTool.js';
import { OCRTool } from './OCRTool.js';
import { ReportTool } from './ReportTool.js';

/**
 * AgentBoard Native MCP Server
 * This process is spawned dynamically per-agent session.
 * It hosts all high-level capabilities (LSP, Task Orchestration).
 */

const userId = process.argv[2] || process.env.USER_ID || 'default';
const sessionId = process.argv[3] || process.env.SESSION_ID || 'unknown';
const userWorkspaceArg = process.argv[4] || process.env.HOME || '/tmp';

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
  new LSPTool(),
  new VisualizerTool(),
  new DataAnalystTool(),
  new OCRTool(),
  new ReportTool(),
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

    const context = { userId, sessionId, userWorkspace: userWorkspaceArg };
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
