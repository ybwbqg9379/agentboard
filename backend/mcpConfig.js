/**
 * MCP (Model Context Protocol) server configuration for AgentBoard agents.
 * Supports stdio transport via npx, and remote transport endpoints via ENV vars.
 *
 * Servers are organised into three tiers:
 *   Core     — filesystem, memory, browser, github, sequential-thinking
 *   Search   — tavily-search, exa-search, brave-search
 *   Crawling — firecrawl, fetch, jina-reader
 */

export function getMcpServers(workspacePath) {
  const servers = {
    // ──────────────────────────────────────────────
    // Core MCP Servers (always available)
    // ──────────────────────────────────────────────
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

    // ──────────────────────────────────────────────
    // Crawling — Fetch MCP (no API key required)
    // Lightweight HTTP fetch + HTML→Markdown conversion
    // ──────────────────────────────────────────────
    fetch: {
      command: 'npx',
      args: ['-y', 'mcp-fetch-server'],
    },
  };

  // ──────────────────────────────────────────────
  // Search — Tavily (AI-optimised search engine)
  // Free 1K queries/month at https://tavily.com
  // ──────────────────────────────────────────────
  if (process.env.TAVILY_API_KEY) {
    servers['tavily-search'] = {
      command: 'npx',
      args: ['-y', 'tavily-mcp@latest'],
      env: {
        TAVILY_API_KEY: process.env.TAVILY_API_KEY,
      },
    };
  }

  // ──────────────────────────────────────────────
  // Crawling — Firecrawl (production-grade scraping)
  // Free 500 pages/month at https://firecrawl.dev
  // ──────────────────────────────────────────────
  if (process.env.FIRECRAWL_API_KEY) {
    servers.firecrawl = {
      command: 'npx',
      args: ['-y', 'firecrawl-mcp'],
      env: {
        FIRECRAWL_API_KEY: process.env.FIRECRAWL_API_KEY,
      },
    };
  }

  // ──────────────────────────────────────────────
  // Crawling — Jina AI Reader (URL→Markdown, search)
  // Best-in-class token efficiency. Free tier at https://jina.ai
  // Supports remote SSE transport or local npx fallback.
  // ──────────────────────────────────────────────
  if (process.env.JINA_API_KEY) {
    if (process.env.JINA_MCP_ENDPOINT) {
      // Remote SSE transport (recommended for latency)
      servers['jina-reader'] = {
        type: 'sse',
        url: process.env.JINA_MCP_ENDPOINT,
        headers: {
          Authorization: `Bearer ${process.env.JINA_API_KEY}`,
        },
      };
    } else {
      // Default: official remote MCP endpoint
      servers['jina-reader'] = {
        type: 'sse',
        url: 'https://mcp.jina.ai/v1',
        headers: {
          Authorization: `Bearer ${process.env.JINA_API_KEY}`,
        },
      };
    }
  }

  // ──────────────────────────────────────────────
  // Search — Exa AI (neural / semantic search)
  // Free tier at https://exa.ai
  // ──────────────────────────────────────────────
  if (process.env.EXA_API_KEY) {
    servers['exa-search'] = {
      command: 'npx',
      args: ['-y', 'exa-mcp-server'],
      env: {
        EXA_API_KEY: process.env.EXA_API_KEY,
      },
    };
  }

  // ──────────────────────────────────────────────
  // Search — Brave Search (privacy-first web search)
  // Free 2K queries/month at https://brave.com/search/api/
  // ──────────────────────────────────────────────
  if (process.env.BRAVE_API_KEY) {
    servers['brave-search'] = {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-brave-search'],
      env: {
        BRAVE_API_KEY: process.env.BRAVE_API_KEY,
      },
    };
  }

  // ──────────────────────────────────────────────
  // Dynamic transport overrides via ENV
  // ──────────────────────────────────────────────

  // Remote browser cluster (replaces local Playwright)
  if (process.env.MCP_BROWSER_ENDPOINT) {
    servers.browser = {
      type: 'sse',
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
 * Dynamically built from whatever servers are configured so it never
 * drifts out of sync with getMcpServers().
 */
export function getAllowedTools(workspacePath) {
  const servers = getMcpServers(workspacePath || '.');
  return Object.keys(servers).map((name) => `mcp__${name}__*`);
}
