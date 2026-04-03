/**
 * Unit tests for MCP server configuration.
 *
 * Verifies: core servers always present, conditional loading via ENV,
 * transport overrides, and getAllowedTools wildcard generation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getMcpServers, getAllowedTools } from './mcpConfig.js';

const WORKSPACE = '/tmp/test-workspace';

// Save and restore env between tests
const envSnapshot = {};
const conditionalKeys = [
  'TAVILY_API_KEY',
  'FIRECRAWL_API_KEY',
  'JINA_API_KEY',
  'JINA_MCP_ENDPOINT',
  'EXA_API_KEY',
  'BRAVE_API_KEY',
  'MCP_BROWSER_ENDPOINT',
  'MCP_BROWSER_TOKEN',
  'GITHUB_TOKEN',
];

beforeEach(() => {
  for (const key of conditionalKeys) {
    envSnapshot[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of conditionalKeys) {
    if (envSnapshot[key] !== undefined) {
      process.env[key] = envSnapshot[key];
    } else {
      delete process.env[key];
    }
  }
});

// ---------------------------------------------------------------------------
// Core servers (always present)
// ---------------------------------------------------------------------------

describe('core MCP servers', () => {
  it('always includes 6 core servers', () => {
    const servers = getMcpServers(WORKSPACE);
    expect(servers.filesystem).toBeDefined();
    expect(servers.memory).toBeDefined();
    expect(servers.browser).toBeDefined();
    expect(servers.github).toBeDefined();
    expect(servers['sequential-thinking']).toBeDefined();
    expect(servers.fetch).toBeDefined();
  });

  it('filesystem server receives workspacePath as arg', () => {
    const servers = getMcpServers(WORKSPACE);
    expect(servers.filesystem.args).toContain(WORKSPACE);
  });

  it('all core servers use npx command', () => {
    const servers = getMcpServers(WORKSPACE);
    for (const name of [
      'filesystem',
      'memory',
      'browser',
      'github',
      'sequential-thinking',
      'fetch',
    ]) {
      expect(servers[name].command).toBe('npx');
    }
  });
});

// ---------------------------------------------------------------------------
// Conditional servers (ENV-based)
// ---------------------------------------------------------------------------

describe('conditional MCP servers', () => {
  it('does NOT include tavily-search without API key', () => {
    const servers = getMcpServers(WORKSPACE);
    expect(servers['tavily-search']).toBeUndefined();
  });

  it('includes tavily-search when TAVILY_API_KEY is set', () => {
    process.env.TAVILY_API_KEY = 'tvly-test-key';
    const servers = getMcpServers(WORKSPACE);
    expect(servers['tavily-search']).toBeDefined();
    expect(servers['tavily-search'].env.TAVILY_API_KEY).toBe('tvly-test-key');
  });

  it('does NOT include firecrawl without API key', () => {
    const servers = getMcpServers(WORKSPACE);
    expect(servers.firecrawl).toBeUndefined();
  });

  it('includes firecrawl when FIRECRAWL_API_KEY is set', () => {
    process.env.FIRECRAWL_API_KEY = 'fc-test-key';
    const servers = getMcpServers(WORKSPACE);
    expect(servers.firecrawl).toBeDefined();
    expect(servers.firecrawl.env.FIRECRAWL_API_KEY).toBe('fc-test-key');
  });

  it('does NOT include jina-reader without API key', () => {
    const servers = getMcpServers(WORKSPACE);
    expect(servers['jina-reader']).toBeUndefined();
  });

  it('includes jina-reader with SSE transport when JINA_API_KEY is set', () => {
    process.env.JINA_API_KEY = 'jina-test-key';
    const servers = getMcpServers(WORKSPACE);
    expect(servers['jina-reader']).toBeDefined();
    expect(servers['jina-reader'].type).toBe('sse');
    expect(servers['jina-reader'].url).toBe('https://mcp.jina.ai/v1');
    expect(servers['jina-reader'].headers.Authorization).toBe('Bearer jina-test-key');
  });

  it('uses custom JINA_MCP_ENDPOINT when set', () => {
    process.env.JINA_API_KEY = 'jina-test-key';
    process.env.JINA_MCP_ENDPOINT = 'https://custom-jina.example.com/mcp';
    const servers = getMcpServers(WORKSPACE);
    expect(servers['jina-reader'].url).toBe('https://custom-jina.example.com/mcp');
  });

  it('does NOT include exa-search without API key', () => {
    const servers = getMcpServers(WORKSPACE);
    expect(servers['exa-search']).toBeUndefined();
  });

  it('includes exa-search when EXA_API_KEY is set', () => {
    process.env.EXA_API_KEY = 'exa-test-key';
    const servers = getMcpServers(WORKSPACE);
    expect(servers['exa-search']).toBeDefined();
    expect(servers['exa-search'].env.EXA_API_KEY).toBe('exa-test-key');
  });

  it('does NOT include brave-search without API key', () => {
    const servers = getMcpServers(WORKSPACE);
    expect(servers['brave-search']).toBeUndefined();
  });

  it('includes brave-search when BRAVE_API_KEY is set', () => {
    process.env.BRAVE_API_KEY = 'brave-test-key';
    const servers = getMcpServers(WORKSPACE);
    expect(servers['brave-search']).toBeDefined();
    expect(servers['brave-search'].env.BRAVE_API_KEY).toBe('brave-test-key');
  });
});

// ---------------------------------------------------------------------------
// Transport overrides
// ---------------------------------------------------------------------------

describe('transport overrides', () => {
  it('overrides browser to SSE when MCP_BROWSER_ENDPOINT is set', () => {
    process.env.MCP_BROWSER_ENDPOINT = 'https://browser.example.com/mcp';
    process.env.MCP_BROWSER_TOKEN = 'br-token';
    const servers = getMcpServers(WORKSPACE);
    expect(servers.browser.type).toBe('sse');
    expect(servers.browser.url).toBe('https://browser.example.com/mcp');
    expect(servers.browser.headers.Authorization).toBe('Bearer br-token');
  });

  it('browser SSE uses empty token when MCP_BROWSER_TOKEN not set', () => {
    process.env.MCP_BROWSER_ENDPOINT = 'https://browser.example.com/mcp';
    const servers = getMcpServers(WORKSPACE);
    expect(servers.browser.headers.Authorization).toBe('Bearer ');
  });

  it('forwards GITHUB_TOKEN to github server env', () => {
    process.env.GITHUB_TOKEN = 'ghp-test-token';
    const servers = getMcpServers(WORKSPACE);
    expect(servers.github.env).toBeDefined();
    expect(servers.github.env.GITHUB_PERSONAL_ACCESS_TOKEN).toBe('ghp-test-token');
  });

  it('does not set github env when GITHUB_TOKEN is absent', () => {
    const servers = getMcpServers(WORKSPACE);
    expect(servers.github.env).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getAllowedTools
// ---------------------------------------------------------------------------

describe('getAllowedTools', () => {
  it('generates mcp__<name>__* pattern for each server', () => {
    const tools = getAllowedTools(WORKSPACE);
    expect(tools).toContain('mcp__filesystem__*');
    expect(tools).toContain('mcp__memory__*');
    expect(tools).toContain('mcp__browser__*');
    expect(tools).toContain('mcp__github__*');
    expect(tools).toContain('mcp__sequential-thinking__*');
    expect(tools).toContain('mcp__fetch__*');
  });

  it('includes conditional servers when ENV is set', () => {
    process.env.TAVILY_API_KEY = 'tvly-test';
    process.env.BRAVE_API_KEY = 'brave-test';
    const tools = getAllowedTools(WORKSPACE);
    expect(tools).toContain('mcp__tavily-search__*');
    expect(tools).toContain('mcp__brave-search__*');
  });

  it('excludes conditional servers when ENV is absent', () => {
    const tools = getAllowedTools(WORKSPACE);
    expect(tools).not.toContain('mcp__tavily-search__*');
    expect(tools).not.toContain('mcp__firecrawl__*');
    expect(tools).not.toContain('mcp__jina-reader__*');
    expect(tools).not.toContain('mcp__exa-search__*');
    expect(tools).not.toContain('mcp__brave-search__*');
  });

  it('uses default workspace path when omitted', () => {
    const tools = getAllowedTools();
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBeGreaterThanOrEqual(6);
  });
});
