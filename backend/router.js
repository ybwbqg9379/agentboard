import { buildRegistry } from './registry.js';
import { getMcpServers } from './mcpConfig.js';
import fs from 'node:fs';

/**
 * Super basic heuristic to guess if a skill/MCP is needed
 * based on the user's prompt and workspace state.
 * @param {string} prompt
 * @param {object} capability (from registry)
 * @param {string} workspaceDir
 */
function isCapabilityRequired(prompt, capability, workspaceDir) {
  const promptLower = prompt.toLowerCase();

  // 1. Check keyword triggers
  if (capability.keywords && capability.keywords.length > 0) {
    const hasKeyword = capability.keywords.some((kw) => promptLower.includes(kw.toLowerCase()));
    if (hasKeyword) return true;
  }

  // 2. Check path-based conditions (e.g., skill only applicable if certain files exist)
  if (capability.paths && capability.paths.length > 0) {
    for (const pattern of capability.paths) {
      if (pattern === '**' || pattern === '*') return true;

      // Super simple glob check (e.g. *.ts, *.py)
      if (pattern.startsWith('*.')) {
        const ext = pattern.slice(1); // .ts
        // Check if prompt mentions the extension
        if (promptLower.includes(ext)) return true;

        // Check if root of workspace has this extension (very basic)
        try {
          const files = fs.readdirSync(workspaceDir);
          if (files.some((f) => f.endsWith(ext))) return true;
        } catch {
          // ignore
        }
      }
    }
  }

  // 3. Skills without any restrictions are always loaded (global skills)
  //    BUT MCP servers without keywords are NOT auto-loaded (to save tokens)
  if (capability.type === 'skill') {
    if (
      (!capability.keywords || capability.keywords.length === 0) &&
      (!capability.paths || capability.paths.length === 0)
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Intercepts the prompt and filters available tools and MCP servers.
 * @param {string} prompt
 * @param {string} workspaceDir
 * @param {string} pluginsDir
 * @returns {object} { allowedTools, selectedMcpServers }
 */
export function routeTools(prompt, workspaceDir, pluginsDir) {
  // Load full definition
  const rawMcp = getMcpServers(workspaceDir);
  const registry = buildRegistry(workspaceDir, pluginsDir, rawMcp);

  const activeCapabilities = registry.filter((cap) =>
    isCapabilityRequired(prompt, cap, workspaceDir),
  );

  const allowedTools = [];
  const selectedMcpServers = {};

  for (const cap of activeCapabilities) {
    if (cap.type === 'skill') {
      // If it's a skill, we assume the original agentManager logic mapped them by default.
      // But we can filter allowedTools
      if (cap.allowedTools) {
        allowedTools.push(...cap.allowedTools);
      }
    } else if (cap.type === 'mcp') {
      if (cap.toolPrefix) {
        allowedTools.push(cap.toolPrefix);
      }
      if (rawMcp[cap.id]) {
        selectedMcpServers[cap.id] = rawMcp[cap.id];
      }
    }
  }

  // Deduplicate tools
  const uniqueAllowedTools = [...new Set(allowedTools)];

  // Always ensure we have some basic tools or fallback to everything if routing filtered too aggressively
  // A real production router would have a fallback intent class
  if (Object.keys(selectedMcpServers).length === 0) {
    // fallback context
    selectedMcpServers.filesystem = rawMcp.filesystem;
    uniqueAllowedTools.push('mcp__filesystem__*');
  }

  return { uniqueAllowedTools, selectedMcpServers };
}
