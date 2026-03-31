import fs from 'node:fs';
import path from 'node:path';

/**
 * Very basic frontmatter parser for SKILL.md files.
 * Supports simple key-value YAML blocks like:
 * ---
 * name: skill-name
 * description: Something
 * allowed-tools:
 *   - ToolA
 *   - ToolB
 * ---
 */
export function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { frontmatter: {}, markdown: content };

  const frontmatterText = match[1];
  const markdown = content.slice(match[0].length).trim();
  const frontmatter = {};

  let currentKey = null;

  const lines = frontmatterText.split(/\r?\n/);
  for (const line of lines) {
    if (line.trim() === '') continue;

    // Check if it's an array item under a key
    const arrayMatch = line.match(/^[\s]+-[\s]+(.*)$/);
    if (arrayMatch && currentKey) {
      if (!Array.isArray(frontmatter[currentKey])) {
        frontmatter[currentKey] = [frontmatter[currentKey]];
      }
      frontmatter[currentKey].push(arrayMatch[1].trim());
      continue;
    }

    // Match top level key value pairs
    const kvMatch = line.match(/^([\w-]+):\s*(.*)$/);
    if (kvMatch) {
      currentKey = kvMatch[1];
      const val = kvMatch[2].trim();
      frontmatter[currentKey] = val === '' ? [] : val; // empty string means it might be an array start
    }
  }

  return { frontmatter, markdown };
}

/**
 * Scan a directory for agentboard-skills and parse them.
 * @param {string} pluginsDir
 * @returns {Array<object>}
 */
export function loadLocalSkills(pluginsDir) {
  const skills = [];
  if (!fs.existsSync(pluginsDir)) return skills;

  const dirs = fs.readdirSync(pluginsDir, { withFileTypes: true });
  for (const dir of dirs) {
    if (dir.isDirectory()) {
      const skillPath = path.join(pluginsDir, dir.name, 'SKILL.md');
      if (fs.existsSync(skillPath)) {
        try {
          const content = fs.readFileSync(skillPath, 'utf-8');
          const { frontmatter } = parseFrontmatter(content);

          skills.push({
            id: frontmatter.name || dir.name,
            type: 'skill',
            path: skillPath,
            description: frontmatter.description || '',
            whenToUse: frontmatter.when_to_use || '',
            paths: frontmatter.paths
              ? Array.isArray(frontmatter.paths)
                ? frontmatter.paths
                : [frontmatter.paths]
              : [],
            allowedTools: frontmatter['allowed-tools']
              ? Array.isArray(frontmatter['allowed-tools'])
                ? frontmatter['allowed-tools']
                : [frontmatter['allowed-tools']]
              : [],
          });
        } catch (err) {
          console.error(`Failed to load skill from ${skillPath}`, err);
        }
      }
    }
  }
  return skills;
}

/**
 * Fetches MCP Capabilities from the active configuration.
 * Maps raw servers to metadata for the router.
 */
export function getMcpCapabilities(mcpServersObj) {
  const metaMap = {
    filesystem: {
      description: 'Read and write files, directories, search local codebase.',
      whenToUse: 'Any task involving reading, editing, or exploring local files.',
      keywords: ['file', 'directory', 'code', 'read', 'write', 'fs', 'grep', 'search'],
    },
    memory: {
      description: 'Store persistent knowledge graph memory.',
      whenToUse: 'Task requires remembering context, entities, and relations across long sessions.',
      keywords: ['remember', 'memory', 'knowledge', 'graph', 'store'],
    },
    browser: {
      description: 'Control a headless browser to navigate, scrape, and interact with the web.',
      whenToUse:
        'Task mentions visiting URLs, scraping, web search, logging into websites, capturing screenshots.',
      keywords: ['web', 'browser', 'url', 'scrape', 'search', 'http', 'playwright'],
    },
    github: {
      description: 'Interact with GitHub APIs (issues, PRs, repos).',
      whenToUse: 'Task involves checking out PRs, reviewing github issues, push/pull from github.',
      keywords: ['github', 'pr', 'issue', 'branch', 'commit'],
    },
    'sequential-thinking': {
      description: 'Perform structured step-by-step thinking for complex logic problems.',
      whenToUse:
        'The user gives a complex puzzle, math problem, or architectural question requiring deep thought.',
      keywords: ['think', 'puzzle', 'plan', 'complex', 'architect'],
    },
  };

  const capabilities = [];
  for (const [name] of Object.entries(mcpServersObj)) {
    const meta = metaMap[name] || { description: 'Generic MCP', whenToUse: '', keywords: [] };
    capabilities.push({
      id: name,
      type: 'mcp',
      toolPrefix: `mcp__${name}__*`,
      ...meta,
    });
  }

  return capabilities;
}

export function buildRegistry(workspaceDir, pluginsDir, mcpServers) {
  const skills = loadLocalSkills(pluginsDir);
  const mcps = getMcpCapabilities(mcpServers);
  return [...skills, ...mcps];
}
