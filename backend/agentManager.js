import { query } from '@anthropic-ai/claude-agent-sdk';
import { EventEmitter } from 'node:events';
import { resolve } from 'node:path';
import config from './config.js';
import {
  createSession,
  updateSessionStatus,
  updateSessionStats,
  insertEvent,
} from './sessionStore.js';
import { getMcpServers, getAllowedTools } from './mcpConfig.js';
import { getAgentDefs } from './agentDefs.js';
import { buildHooks } from './hooks.js';
import { initMcpHealth } from './mcpHealth.js';

// 活跃的 Agent Query Map<sessionId, { stream, timeoutId }>
const activeAgents = new Map();

export const agentEvents = new EventEmitter();

const WORKSPACE = resolve(config.workspaceDir);
const PLUGINS_DIR = resolve(config.pluginsDir);

// Valid permission modes exposed to the frontend
export const PERMISSION_MODES = ['bypassPermissions', 'default', 'acceptEdits', 'plan'];

/**
 * 启动一个 Claude Code Agent (SDK 方式)
 * @param {string} prompt - 用户指令
 * @param {object} [opts] - 启动选项
 * @param {string} [opts.permissionMode] - 权限模式
 * @param {number} [opts.maxTurns] - 最大轮次
 * @returns {string} sessionId
 */
export function startAgent(prompt, opts = {}) {
  const sessionId = createSession(prompt);
  const permMode = PERMISSION_MODES.includes(opts.permissionMode)
    ? opts.permissionMode
    : 'bypassPermissions';
  const needsSkip = permMode === 'bypassPermissions';

  const stream = query({
    prompt,
    options: {
      cwd: WORKSPACE,
      permissionMode: permMode,
      allowDangerouslySkipPermissions: needsSkip,
      maxTurns: opts.maxTurns || 50,
      systemPrompt: {
        type: 'preset',
        preset: 'claude_code',
        append: [
          `[SECURITY] You are sandboxed to: ${WORKSPACE}`,
          `All file operations MUST stay within this directory.`,
          `NEVER use absolute paths outside ${WORKSPACE}.`,
          `NEVER access parent directories beyond ${WORKSPACE}.`,
          ``,
          `[WEB ACCESS] You have three web access methods. Use them wisely:`,
          `  1. WebSearch: can be used for quick queries, but results may be limited.`,
          `  2. WebFetch: works for many sites, but some will block with 403.`,
          `  3. Playwright MCP (mcp__browser__*): the most reliable method, works on any site.`,
          `     - browser_navigate → browser_snapshot to read content`,
          `     - browser_evaluate to extract data via JS`,
          `     - browser_click / browser_type / browser_fill_form to interact`,
          `Rules:`,
          `  - If WebFetch returns 403 or "unable to fetch", do NOT retry the same URL. Switch to Playwright immediately.`,
          `  - For sites known to block bots (wsj.com, bloomberg.com, ft.com), use Playwright directly.`,
          `  - For web search, you can use WebSearch or navigate to google.com via Playwright.`,
        ].join('\n'),
      },
      settingSources: [],
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        TMPDIR: resolve(WORKSPACE, '.tmp'),
        ANTHROPIC_BASE_URL: config.proxy.url,
        ANTHROPIC_API_KEY: config.llm.apiKey || 'placeholder',
        CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING: '1',
      },

      // MCP Servers
      mcpServers: getMcpServers(WORKSPACE),
      allowedTools: getAllowedTools(),

      // Subagents
      agents: getAgentDefs(),

      // Hooks
      hooks: buildHooks(agentEvents, sessionId),

      // Streaming deltas for real-time rendering
      includePartialMessages: true,

      // File change tracking for rollback (SDK mode uses env var)
      enableFileCheckpointing: true,
      // Also set env var for SDK mode compatibility

      // Skills (via local plugin)
      plugins: [{ type: 'local', path: resolve(PLUGINS_DIR, 'agentboard-skills') }],
    },
  });

  // 超时保护
  const timeoutId = setTimeout(() => {
    if (activeAgents.has(sessionId)) {
      stopAgent(sessionId);
    }
  }, config.agentTimeout);

  activeAgents.set(sessionId, { stream, timeoutId, stopped: false });

  // 异步消费事件流
  (async () => {
    let finalStatus = 'completed';
    try {
      for await (const message of stream) {
        // Override model name with actual target model for init events
        let msg = message;
        if (msg.type === 'system' && msg.subtype === 'init') {
          msg = { ...msg, model: config.llm.model };
          if (msg.mcp_servers) initMcpHealth(msg.mcp_servers);
        }

        const wrapped = {
          sessionId,
          type: msg.type,
          subtype: msg.subtype || null,
          content: msg,
          timestamp: Date.now(),
        };

        insertEvent(sessionId, msg.type, msg);
        agentEvents.emit('event', wrapped);

        // Extract session stats from result messages
        if (msg.type === 'result') {
          const stats = {
            cost_usd: msg.total_cost_usd || 0,
            input_tokens: msg.usage?.input_tokens || 0,
            output_tokens: msg.usage?.output_tokens || 0,
            duration_ms: msg.duration_ms || 0,
            num_turns: msg.num_turns || 0,
            model: null,
          };
          stats.model = config.llm.model;
          updateSessionStats(sessionId, stats);
        }
      }
    } catch (err) {
      finalStatus = 'failed';
      const errEvent = {
        sessionId,
        type: 'stderr',
        content: { text: err.message || String(err) },
        timestamp: Date.now(),
      };
      insertEvent(sessionId, 'stderr', { text: err.message });
      agentEvents.emit('event', errEvent);
    } finally {
      const entry = activeAgents.get(sessionId);
      if (entry) {
        clearTimeout(entry.timeoutId);
        if (entry.stopped) finalStatus = 'stopped';
      }
      activeAgents.delete(sessionId);
      updateSessionStatus(sessionId, finalStatus);
      agentEvents.emit('event', {
        sessionId,
        type: 'done',
        content: { status: finalStatus },
        timestamp: Date.now(),
      });
    }
  })();

  return sessionId;
}

/**
 * 停止一个运行中的 Agent
 */
export function stopAgent(sessionId) {
  const entry = activeAgents.get(sessionId);
  if (!entry) return false;

  entry.stopped = true;
  clearTimeout(entry.timeoutId);
  try {
    entry.stream.return();
  } catch (err) {
    console.warn(`[agentManager] stream.return() error: ${err.message}`);
  }
  return true;
}

/**
 * 获取活跃 Agent 列表
 */
export function getActiveAgents() {
  return [...activeAgents.keys()];
}

/**
 * 获取运行中 Agent 的 stream 对象，用于 stream control
 */
export function getAgentStream(sessionId) {
  const entry = activeAgents.get(sessionId);
  return entry?.stream || null;
}
