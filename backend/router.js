import { buildRegistry } from './registry.js';
import { getMcpServers } from './mcpConfig.js';
import fs from 'node:fs';

// ─────────────────────────────────────────────────────────────────────────────
// Intent Classification — maps high-level user intents to MCP categories.
// Each intent carries a confidence boost and a set of required categories.
// When an intent fires, ALL MCP servers in the required categories are
// co-activated together, avoiding the fragile single-keyword-hit approach.
// ─────────────────────────────────────────────────────────────────────────────

const INTENT_PATTERNS = [
  {
    id: 'web-research',
    description: 'User wants to research a topic on the web and analyse findings',
    patterns: [
      /(?:research|investigate|find out|look up|查一下|调研|研究|了解)/i,
      /(?:what (?:is|are)|who (?:is|are)|how (?:does|do|to)|tell me about)/i,
      /(?:latest|current|recent|trending|news|market|行情|最新|最近|趋势|新闻)/i,
      /(?:compare|comparison|vs\.?|versus|对比|比较)/i,
      /(?:search.*(?:and|then).*(?:analy[sz]e|extract|summar))/i,
    ],
    // Co-activate: search + crawl + memory (to persist findings)
    requiredCategories: ['search', 'crawl'],
    optionalCategories: ['memory'],
  },
  {
    id: 'web-scraping',
    description: 'User wants to scrape/crawl specific websites for data',
    patterns: [
      /(?:scrape|crawl|extract.*(?:data|info|content)|spider)/i,
      /(?:爬取|抓取|爬虫|提取.*(?:数据|信息|内容))/i,
      /(?:batch.*(?:url|page|site)|sitemap|站点地图|批量)/i,
      /(?:structured.*data|json.*from|table.*from|csv.*from)/i,
      /(?:dataset|数据集)/i,
    ],
    requiredCategories: ['crawl'],
    optionalCategories: ['search', 'memory'],
  },
  {
    id: 'url-reading',
    description: 'User provides a URL and wants to read/analyse its content',
    patterns: [
      /https?:\/\/[^\s]+/i, // any URL in the prompt
      /(?:read|open|visit|check|look at).*(?:page|site|link|url|website)/i,
      /(?:读取|打开|访问|查看).*(?:页面|网站|链接|网址)/i,
    ],
    requiredCategories: ['crawl'],
    optionalCategories: [],
  },
  {
    id: 'data-analysis',
    description: 'User wants to analyse data from the web',
    patterns: [
      /(?:analy[sz]e|summar|breakdown|insight|report|分析|总结|报告|洞察)/i,
      /(?:trend|pattern|statistic|指标|统计|规律)/i,
    ],
    // Analysis alone doesn't trigger web tools — but when combined with
    // search/crawl intents, it brings in memory for persistence.
    requiredCategories: [],
    optionalCategories: ['memory', 'sequential-thinking'],
  },
];

/**
 * Classifies the user prompt into zero or more intents.
 * Returns matched intents sorted by number of pattern hits (best first).
 * @param {string} prompt
 * @returns {Array<{ id: string, hitCount: number, requiredCategories: string[], optionalCategories: string[] }>}
 */
function classifyIntent(prompt) {
  const results = [];
  for (const intent of INTENT_PATTERNS) {
    const hitCount = intent.patterns.filter((p) => p.test(prompt)).length;
    if (hitCount > 0) {
      results.push({
        id: intent.id,
        hitCount,
        requiredCategories: intent.requiredCategories,
        optionalCategories: intent.optionalCategories,
      });
    }
  }
  // Sort by hit count descending — higher confidence first
  results.sort((a, b) => b.hitCount - a.hitCount);
  return results;
}

/**
 * Check if a capability is required based on the user prompt.
 * Enhanced with intent-based co-activation.
 * @param {string} prompt
 * @param {object} capability (from registry)
 * @param {string} workspaceDir
 * @param {Set<string>} intentCategories — categories from intent classification
 */
function isCapabilityRequired(prompt, capability, workspaceDir, intentCategories) {
  const promptLower = prompt.toLowerCase();

  // 1. Intent-based co-activation — if the capability's category was
  //    activated by an intent, it's required regardless of keywords.
  if (capability.category && intentCategories.has(capability.category)) {
    return true;
  }

  // 2. Check keyword triggers (original heuristic, still valuable for
  //    specific tool mentions like "screenshot" → browser)
  if (capability.keywords && capability.keywords.length > 0) {
    const hasKeyword = capability.keywords.some((kw) => promptLower.includes(kw.toLowerCase()));
    if (hasKeyword) return true;
  }

  // 3. Check path-based conditions (e.g., skill only applicable if certain files exist)
  if (capability.paths && capability.paths.length > 0) {
    for (const pattern of capability.paths) {
      if (pattern === '**' || pattern === '*') return true;

      if (pattern.startsWith('*.')) {
        const ext = pattern.slice(1);
        if (promptLower.includes(ext)) return true;

        try {
          const files = fs.readdirSync(workspaceDir);
          if (files.some((f) => f.endsWith(ext))) return true;
        } catch {
          // ignore
        }
      }
    }
  }

  // 4. Skills without any restrictions are always loaded (global skills)
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
 * Uses a two-pass approach:
 *   Pass 1 — Intent classification to determine co-activation groups
 *   Pass 2 — Per-capability keyword/path matching (with intent boost)
 *
 * @param {string} prompt
 * @param {string} workspaceDir
 * @param {string} pluginsDir
 * @returns {object} { uniqueAllowedTools, selectedMcpServers, detectedIntents }
 */
export function routeTools(prompt, workspaceDir, pluginsDir) {
  // Load full definition
  const rawMcp = getMcpServers(workspaceDir);
  const registry = buildRegistry(workspaceDir, pluginsDir, rawMcp);

  // ── Pass 1: Intent Classification ──
  const detectedIntents = classifyIntent(prompt);
  const intentCategories = new Set();
  for (const intent of detectedIntents) {
    for (const cat of intent.requiredCategories) {
      intentCategories.add(cat);
    }
    // Optional categories are only activated when combined with
    // other intents or keyword matches.
    // If there are 2+ intents, also fire optional categories.
    if (detectedIntents.length >= 2) {
      for (const cat of intent.optionalCategories) {
        intentCategories.add(cat);
      }
    }
  }

  // If a 'sequential-thinking' type category is in optional and we have
  // a data-analysis intent, activate it.
  if (detectedIntents.some((i) => i.id === 'data-analysis')) {
    for (const intent of detectedIntents) {
      for (const cat of intent.optionalCategories) {
        intentCategories.add(cat);
      }
    }
  }

  // ── Pass 2: Capability Matching ──
  const activeCapabilities = registry.filter((cap) =>
    isCapabilityRequired(prompt, cap, workspaceDir, intentCategories),
  );

  const allowedTools = [];
  const selectedMcpServers = {};

  for (const cap of activeCapabilities) {
    if (cap.type === 'skill') {
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

  // Always ensure we have some basic tools or fallback to everything if
  // routing filtered too aggressively
  if (Object.keys(selectedMcpServers).length === 0) {
    selectedMcpServers.filesystem = rawMcp.filesystem;
    uniqueAllowedTools.push('mcp__filesystem__*');
  }

  return {
    uniqueAllowedTools,
    selectedMcpServers,
    // Expose detected intents for observability / debugging
    detectedIntents: detectedIntents.map((i) => i.id),
  };
}
