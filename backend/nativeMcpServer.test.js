/**
 * Loads nativeMcpServer with Docker / agent / memory / LSP stubbed so imports stay light.
 * Exercises MCP list-tools and call-tool dispatch.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mcpHandlers = vi.hoisted(() => ({ list: null, call: null }));
const { agentBus } = vi.hoisted(() => {
  const map = new Map();
  const bus = {
    on(ev, fn) {
      const arr = map.get(ev) || [];
      arr.push(fn);
      map.set(ev, arr);
    },
    off(ev, fn) {
      const arr = (map.get(ev) || []).filter((x) => x !== fn);
      map.set(ev, arr);
    },
    emit(ev, data) {
      for (const fn of map.get(ev) || []) fn(data);
    },
    setMaxListeners() {},
  };
  return { agentBus: bus };
});

vi.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: class {
    setRequestHandler(_schema, fn) {
      if (mcpHandlers.list == null) mcpHandlers.list = fn;
      else mcpHandlers.call = fn;
    }
    connect() {
      return Promise.resolve();
    }
  },
}));

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: class {},
}));

vi.mock('./tools/dockerSandbox.js', () => ({
  executeInSandbox: vi.fn().mockResolvedValue({
    stdout: '1',
    stderr: '',
    exitCode: 0,
  }),
}));

vi.mock('./agentManager.js', () => ({
  startAgent: vi.fn().mockResolvedValue('mock-sub-session'),
  continueAgent: vi.fn().mockResolvedValue(false),
  stopAgent: vi.fn(() => false),
  getActiveAgents: vi.fn(() => []),
  getAgentStream: vi.fn(() => null),
  agentEvents: agentBus,
  PERMISSION_MODES: ['bypassPermissions', 'default', 'acceptEdits', 'plan'],
}));

vi.mock('./memoryStore.js', () => ({
  saveEntity: vi.fn().mockResolvedValue(undefined),
  saveRelation: vi.fn().mockResolvedValue(undefined),
  getUserMemoryGraph: vi.fn().mockResolvedValue({ entities: [], relations: [] }),
}));

vi.mock('./tools/LSPTool.js', () => ({
  LSPTool: class {
    constructor() {
      this.name = 'LSPTool';
    }
    getToolDef() {
      return {
        name: this.name,
        description: 'mock',
        input_schema: { type: 'object', properties: {} },
      };
    }
    async call() {
      return { content: [{ type: 'text', text: 'lsp-mock' }], isError: false };
    }
  },
}));

await import('./tools/nativeMcpServer.js');

describe('nativeMcpServer MCP handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('listTools returns REPLTool and other registered tools', async () => {
    const { tools } = await mcpHandlers.list();
    const names = tools.map((t) => t.name);
    expect(names).toContain('REPLTool');
    expect(names).toContain('TaskCreate');
    expect(names).toContain('Remember');
    expect(names).toContain('Recall');
    expect(names).toContain('LSPTool');
  });

  it('callTool runs REPLTool with workspace context', async () => {
    const { executeInSandbox } = await import('./tools/dockerSandbox.js');
    const res = await mcpHandlers.call({
      params: {
        name: 'REPLTool',
        arguments: { code: '2+2', language: 'node' },
      },
    });
    expect(res.isError).toBeFalsy();
    expect(res.content[0].text).toContain('Exit Code: 0');
    expect(executeInSandbox).toHaveBeenCalled();
  });

  it('callTool returns isError for unknown tool name', async () => {
    const res = await mcpHandlers.call({
      params: {
        name: 'NotARealTool',
        arguments: {},
      },
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/Unknown tool|Internal Orchestration Error/i);
  });
});
