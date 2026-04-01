import { describe, it, expect, vi } from 'vitest';
import { routeTools } from './router.js';
import * as registryModule from './registry.js';
import * as mcpConfigModule from './mcpConfig.js';
import fs from 'node:fs';

// Mock dependencies
vi.mock('./registry.js');
vi.mock('./mcpConfig.js');
vi.mock('node:fs');

describe('router.js - Context Router Integration', () => {
  it('should accurately route and filter tools based on prompt keywords and paths', () => {
    // Basic subset routing as seen previously
    const mockMcp = { filesystem: {}, browser: {}, 'ts-checker': {} };
    mcpConfigModule.getMcpServers.mockReturnValue(mockMcp);

    registryModule.buildRegistry.mockReturnValue([
      {
        id: 'filesystem',
        type: 'mcp',
        toolPrefix: 'mcp__filesystem__*',
        keywords: ['file', 'code'],
      },
      { id: 'browser', type: 'mcp', toolPrefix: 'mcp__browser__*', keywords: ['web', 'scrape'] },
      { id: 'ts-checker', type: 'skill', paths: ['*.ts'], allowedTools: ['Grep', 'Bash'] },
    ]);

    // Test: Only web-related prompt -> NO file system, NO Bash
    const webResult = routeTools('Scrape this url please', '/fake/workspace', '/fake/plugins');
    expect(webResult.selectedMcpServers).toHaveProperty('browser');
    expect(webResult.selectedMcpServers).not.toHaveProperty('filesystem');
    expect(webResult.uniqueAllowedTools).toContain('mcp__browser__*');
    expect(webResult.uniqueAllowedTools).not.toContain('Grep');

    // Test: File-related prompt matching .ts keyword -> Loads file system and ts-checker
    const codeResult = routeTools(
      'Check if app.ts has clean code',
      '/fake/workspace',
      '/fake/plugins',
    );
    expect(codeResult.selectedMcpServers).toHaveProperty('filesystem');
    expect(codeResult.selectedMcpServers).not.toHaveProperty('browser');
    expect(codeResult.uniqueAllowedTools).toContain('mcp__filesystem__*');
    expect(codeResult.uniqueAllowedTools).toContain('Grep');
  });

  it('should safely fall back to the filesystem and default tools if no constraints match but prompt is vague', () => {
    // If router eliminates everything (prompt: "hello"), it must fallback to the filesystem
    mcpConfigModule.getMcpServers.mockReturnValue({ filesystem: {}, browser: {} });
    registryModule.buildRegistry.mockReturnValue([
      { id: 'filesystem', type: 'mcp', toolPrefix: 'mcp__filesystem__*', keywords: ['file'] },
      { id: 'browser', type: 'mcp', toolPrefix: 'mcp__browser__*', keywords: ['web'] },
    ]);

    const result = routeTools('hello', '/fake', '/fake');
    // Expect fallback mechanism to inject raw filesystem so the agent isn't completely blind
    expect(result.selectedMcpServers).toHaveProperty('filesystem');
    expect(result.uniqueAllowedTools).toContain('mcp__filesystem__*');
  });

  it('should include unconditional skills (no keywords, no restrictive paths)', () => {
    mcpConfigModule.getMcpServers.mockReturnValue({ filesystem: {} });
    registryModule.buildRegistry.mockReturnValue([
      { id: 'global-thinker', type: 'skill', allowedTools: ['Think'], keywords: [], paths: [] },
    ]);

    // Even if prompt is unrelated, the unconditional skill should be mounted
    const result = routeTools('do something', '/fake', '/fake');
    expect(result.uniqueAllowedTools).toContain('Think');
  });

  it('should NOT include MCP servers without keyword match (strict mode)', () => {
    const mockMcp = { filesystem: {}, browser: {} };
    mcpConfigModule.getMcpServers.mockReturnValue(mockMcp);
    registryModule.buildRegistry.mockReturnValue([
      { id: 'filesystem', type: 'mcp', toolPrefix: 'mcp__filesystem__*', keywords: ['file'] },
      { id: 'browser', type: 'mcp', toolPrefix: 'mcp__browser__*', keywords: ['web'] },
      { id: 'no-keywords-mcp', type: 'mcp', toolPrefix: 'mcp__noop__*', keywords: [] },
    ]);

    // MCP without keywords should NOT be included
    const result = routeTools('hello', '/fake', '/fake');
    expect(result.uniqueAllowedTools).not.toContain('mcp__noop__*');
    // Filesystem fallback should still be there
    expect(result.selectedMcpServers).toHaveProperty('filesystem');
  });

  it('should match Chinese keywords for MCP routing', () => {
    const mockMcp = { browser: {} };
    mcpConfigModule.getMcpServers.mockReturnValue(mockMcp);
    registryModule.buildRegistry.mockReturnValue([
      {
        id: 'browser',
        type: 'mcp',
        toolPrefix: 'mcp__browser__*',
        keywords: ['web', '浏览器', '网页'],
      },
    ]);

    const result = routeTools('打开浏览器看看新闻', '/fake', '/fake');
    expect(result.selectedMcpServers).toHaveProperty('browser');
    expect(result.uniqueAllowedTools).toContain('mcp__browser__*');
  });

  it('should match path glob extensions by checking the workspace root automatically', () => {
    mcpConfigModule.getMcpServers.mockReturnValue({ filesystem: {} });
    registryModule.buildRegistry.mockReturnValue([
      { id: 'python-runner', type: 'skill', allowedTools: ['PyRun'], paths: ['*.py'] },
    ]);

    // Mock fs.readdirSync to pretend `.py` files exist in root
    fs.readdirSync.mockReturnValue(['main.py', 'helper.js']);

    // Prompt doesn't mention .py, but workspace *has* .py!
    const result = routeTools('start the server', '/fake', '/fake');
    expect(result.uniqueAllowedTools).toContain('PyRun');
  });
});
