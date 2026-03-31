/**
 * MCP (Model Context Protocol) server configuration for AgentBoard agents.
 * Supports stdio transport via npx, and remote transport endpoints via ENV vars.
 */

export function getMcpServers(workspacePath) {
  const servers = {
    filesystem: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', workspacePath],
    },
    memory: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-memory'],
    },
    browser: {
      command: 'npx',
      args: ['-y', '@playwright/mcp', '--headless'],
    },
    github: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
    },
    'sequential-thinking': {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
    },
  };

  // Example of supporting distributed/remote endpoints via Environment Variable fallback:
  // If the user has a remote browser cluster running, use SSE instead of stdio.
  if (process.env.MCP_BROWSER_ENDPOINT) {
    servers.browser = {
      type: 'sse', // Dynamic Transport Type
      url: process.env.MCP_BROWSER_ENDPOINT,
      headers: {
        Authorization: `Bearer ${process.env.MCP_BROWSER_TOKEN || ''}`,
      },
    };
  }

  // Forward the GitHub token if available in the host environment.
  if (process.env.GITHUB_TOKEN && !servers.github.env) {
    servers.github.env = {
      GITHUB_PERSONAL_ACCESS_TOKEN: process.env.GITHUB_TOKEN,
    };
  }

  return servers;
}

/**
 * Returns the baseline list of allowed MCP tool wildcard patterns.
 * (This is primarily preserved for backward compatibility if router is skipped)
 */
export function getAllowedTools() {
  return [
    'mcp__filesystem__*',
    'mcp__memory__*',
    'mcp__browser__*',
    'mcp__github__*',
    'mcp__sequential-thinking__*',
  ];
}
