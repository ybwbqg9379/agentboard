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
    // ── Core MCP Servers ──────────────────────────
    filesystem: {
      description: 'Read and write files, directories, search local codebase.',
      whenToUse: 'Any task involving reading, editing, or exploring local files.',
      category: 'core',
      keywords: [
        'file',
        'directory',
        'code',
        'read',
        'write',
        'fs',
        'grep',
        'search',
        '文件',
        '目录',
        '代码',
        '读取',
        '写入',
        '搜索',
      ],
    },
    memory: {
      description: 'Store persistent knowledge graph memory.',
      whenToUse: 'Task requires remembering context, entities, and relations across long sessions.',
      category: 'core',
      keywords: [
        'remember',
        'memory',
        'knowledge',
        'graph',
        'store',
        '记忆',
        '记住',
        '知识图谱',
        '存储',
      ],
    },
    browser: {
      description: 'Control a headless browser to navigate, scrape, and interact with the web.',
      whenToUse:
        'Task mentions visiting URLs, scraping, web search, logging into websites, capturing screenshots.',
      category: 'browser',
      keywords: [
        'web',
        'browser',
        'url',
        'scrape',
        'search',
        'http',
        'playwright',
        'screenshot',
        'navigate',
        'click',
        'login',
        '浏览器',
        '网页',
        '抓取',
        '爬虫',
        '搜索',
        '截图',
        '登录',
      ],
    },
    github: {
      description: 'Interact with GitHub APIs (issues, PRs, repos).',
      whenToUse: 'Task involves checking out PRs, reviewing github issues, push/pull from github.',
      category: 'core',
      keywords: ['github', 'pr', 'issue', 'branch', 'commit', 'repo', 'pull request'],
    },
    'sequential-thinking': {
      description: 'Perform structured step-by-step thinking for complex logic problems.',
      whenToUse:
        'The user gives a complex puzzle, math problem, or architectural question requiring deep thought.',
      category: 'core',
      keywords: [
        'think',
        'puzzle',
        'plan',
        'complex',
        'architect',
        'reason',
        '思考',
        '推理',
        '分析',
        '规划',
        '架构',
      ],
    },

    // ── Search MCP Servers ────────────────────────
    'tavily-search': {
      description: 'AI-optimised web search engine with content extraction and filtering.',
      whenToUse:
        'User needs real-time web information, news, research data, market trends, or competitive intelligence.',
      category: 'search',
      keywords: [
        'search',
        'find',
        'lookup',
        'google',
        'news',
        'research',
        'latest',
        'current',
        'recent',
        'trend',
        'market',
        'data',
        'information',
        'what is',
        'who is',
        'how to',
        '搜索',
        '查找',
        '查询',
        '新闻',
        '研究',
        '最新',
        '趋势',
        '数据',
        '市场',
        '信息',
        '什么是',
        '怎么',
        '如何',
      ],
    },
    'exa-search': {
      description:
        'Neural semantic search engine — finds high-quality, relevant web content and similar pages.',
      whenToUse:
        'User needs deep research, academic/documentation search, finding similar resources, or semantic content discovery.',
      category: 'search',
      keywords: [
        'research',
        'academic',
        'paper',
        'documentation',
        'similar',
        'semantic',
        'find like',
        'related',
        'citation',
        'reference',
        '论文',
        '文献',
        '学术',
        '类似',
        '相关',
        '参考',
        '引用',
      ],
    },
    'brave-search': {
      description: 'Privacy-first web search with AI summaries, image, video, and news search.',
      whenToUse:
        'User requests a general web search, image search, video search, or privacy-conscious lookup.',
      category: 'search',
      keywords: [
        'search',
        'brave',
        'image search',
        'video search',
        'news search',
        'privacy',
        '图片搜索',
        '视频搜索',
      ],
    },

    // ── Crawling MCP Servers ──────────────────────
    firecrawl: {
      description:
        'Production-grade web scraping & crawling — single-page scrape, batch processing, site mapping, and structured data extraction.',
      whenToUse:
        'User wants to scrape websites, extract structured data from pages, crawl entire sites, batch-process URLs, or build datasets.',
      category: 'crawl',
      keywords: [
        'scrape',
        'crawl',
        'extract',
        'website',
        'page',
        'content',
        'data',
        'batch',
        'sitemap',
        'parse',
        'dataset',
        'table',
        'structured',
        '爬取',
        '抓取',
        '提取',
        '网站',
        '页面',
        '内容',
        '数据',
        '批量',
        '结构化',
        '表格',
        '数据集',
      ],
    },
    fetch: {
      description:
        'Simple HTTP fetch and HTML-to-Markdown conversion for any URL. No API key required.',
      whenToUse:
        'User provides a specific URL to read, or wants to quickly fetch and convert a single web page to text.',
      category: 'crawl',
      keywords: [
        'fetch',
        'url',
        'read',
        'page',
        'link',
        'http',
        'website',
        'open',
        'visit',
        '获取',
        '读取',
        '链接',
        '网址',
        '打开',
        '访问',
      ],
    },
    'jina-reader': {
      description:
        'High-efficiency URL-to-Markdown reader and grounded web search. Best-in-class token efficiency for LLM content extraction.',
      whenToUse:
        'User wants to read a web page with minimal token usage, convert URL to clean markdown, or perform a grounded search with citations.',
      category: 'crawl',
      keywords: [
        'read',
        'url',
        'markdown',
        'convert',
        'extract',
        'reader',
        'jina',
        'content',
        'article',
        'blog',
        'document',
        '阅读',
        '转换',
        '文章',
        '博客',
        '文档',
      ],
    },
  };

  const capabilities = [];
  for (const [name] of Object.entries(mcpServersObj)) {
    const meta = metaMap[name] || {
      description: 'Generic MCP',
      whenToUse: '',
      category: 'core',
      keywords: [],
    };
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
