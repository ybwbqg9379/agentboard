/**
 * MCP (Model Context Protocol) server configuration for AgentBoard agents.
 *
 * Each server uses stdio transport via npx, so no global install is required.
 */

/**
 * Returns the MCP server configuration object.
 *
 * @param {string} workspacePath - Absolute path the filesystem server may access.
 * @returns {Record<string, object>} Server name -> config map.
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
      args: ['-y', '@playwright/mcp'],
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

  // Forward the GitHub token if available in the host environment.
  if (process.env.GITHUB_TOKEN) {
    servers.github.env = {
      GITHUB_PERSONAL_ACCESS_TOKEN: process.env.GITHUB_TOKEN,
    };
  }

  return servers;
}

/**
 * Returns the list of allowed MCP tool wildcard patterns.
 *
 * @returns {string[]}
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
