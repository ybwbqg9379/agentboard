import { query } from '@anthropic-ai/claude-agent-sdk';
import { EventEmitter } from 'node:events';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import config from './config.js';
import {
  createSession,
  updateSessionStatus,
  updateSessionStats,
  insertEvent,
} from './sessionStore.js';
import { routeTools } from './router.js';
import { getAgentDefs } from './agentDefs.js';
import { buildHooks } from './hooks.js';
import { initMcpHealth } from './mcpHealth.js';

// 活跃的 Agent Query Map<sessionId, { stream, timeoutId }>
const activeAgents = new Map();

export const agentEvents = new EventEmitter();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PLUGINS_DIR = resolve(config.pluginsDir);

function getUserWorkspace(userId) {
  // If SaaS mode is strictly enforcing isolation, we append userId.
  // For backwards compat locally without a token, we might just append 'default' or use root.
  // Using a subfolder per tenant is safest.
  if (!userId || userId === 'default') return resolve(config.workspaceDir);
  return resolve(config.workspaceDir, userId);
}

// Valid permission modes exposed to the frontend
export const PERMISSION_MODES = ['bypassPermissions', 'default', 'acceptEdits', 'plan'];

// Shared system prompt appended to all agent sessions
const getSystemPromptAppend = (userWorkspace) =>
  [
    `[SECURITY] You are sandboxed to: ${userWorkspace}`,
    `All file operations MUST stay within this directory.`,
    `NEVER use absolute paths outside ${userWorkspace}.`,
    `NEVER access parent directories beyond ${userWorkspace}.`,
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
    ``,
    `[EFFICIENCY] Be focused and concise:`,
    `  - For research/information tasks: gather key data from 2-3 authoritative sources, then synthesize and present your findings. Do NOT exhaustively search every source.`,
    `  - If you have enough information to answer the user's question, write your response immediately. Do not keep searching "just in case."`,
    `  - Avoid redundant searches: do not look up the same information with different tools or rephrased queries.`,
    `  - Most tasks should complete within 20 tool calls. If you have used 30+ tools without a clear result, summarize what you have and deliver it.`,
    `  - When presenting results, be structured and direct. Use tables or bullet points for data-heavy answers.`,
  ].join('\n');

/**
 * Build the base options shared between startAgent and continueAgent.
 */
function buildBaseOptions(sessionId, permMode, prompt, userId) {
  const needsSkip = permMode === 'bypassPermissions';
  const userWorkspace = getUserWorkspace(userId);

  // Conditionally route tools and MCPs based on user intent
  const { uniqueAllowedTools, selectedMcpServers } = routeTools(
    prompt,
    userWorkspace,
    resolve(PLUGINS_DIR, 'agentboard-skills'),
  );

  // Dynamically inject the Native MCP Server to host our proprietary JS tools (Phase 2)
  selectedMcpServers.agentboard_native = {
    command: 'node',
    args: [
      resolve(__dirname, 'tools/nativeMcpServer.js'),
      userId || 'default',
      sessionId,
      userWorkspace,
    ],
  };
  uniqueAllowedTools.push('mcp__agentboard_native__*');

  return {
    cwd: userWorkspace,
    permissionMode: permMode,
    allowDangerouslySkipPermissions: needsSkip,
    systemPrompt: {
      type: 'preset',
      preset: 'claude_code',
      append: getSystemPromptAppend(userWorkspace),
    },
    settingSources: [],
    env: {
      PATH: '/usr/local/bin:/usr/bin:/bin',
      HOME: userWorkspace,
      TMPDIR: resolve(userWorkspace, '.tmp'),
      ANTHROPIC_BASE_URL: config.proxy.url,
      ANTHROPIC_API_KEY: config.llm.apiKey || 'placeholder',
      CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING: '1',
    },
    mcpServers: selectedMcpServers,
    allowedTools: uniqueAllowedTools,
    agents: getAgentDefs(),
    hooks: buildHooks(agentEvents, sessionId, userWorkspace),
    includePartialMessages: true,
    enableFileCheckpointing: true,
    plugins: [{ type: 'local', path: resolve(PLUGINS_DIR, 'agentboard-skills') }],
  };
}

/**
 * Consume the SDK event stream, persist events, and broadcast via WebSocket.
 */
function consumeStream(sessionId, stream) {
  const timeoutId = setTimeout(() => {
    if (activeAgents.has(sessionId)) {
      stopAgent(sessionId);
    }
  }, config.agentTimeout);

  activeAgents.set(sessionId, { stream, timeoutId, stopped: false });

  (async () => {
    let finalStatus = 'completed';
    try {
      for await (const message of stream) {
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

        if (msg.type === 'result') {
          const stats = {
            cost_usd: msg.total_cost_usd || 0,
            input_tokens: msg.usage?.input_tokens || 0,
            output_tokens: msg.usage?.output_tokens || 0,
            cache_read_tokens:
              msg.usage?.cache_read_input_tokens || msg.usage?.cache_read_tokens || 0,
            duration_ms: msg.duration_ms || 0,
            num_turns: msg.num_turns || 0,
            model: config.llm.model,
          };
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
}

/**
 * 启动一个 Claude Code Agent (SDK 方式)
 * @param {string} prompt - 用户指令
 * @param {object} [opts] - 启动选项
 * @param {string} [opts.permissionMode] - 权限模式
 * @param {number} [opts.maxTurns] - 最大轮次
 * @returns {string} sessionId
 */
export function startAgent(prompt, opts = {}) {
  const sessionId = createSession(opts.userId, prompt);
  const permMode = PERMISSION_MODES.includes(opts.permissionMode)
    ? opts.permissionMode
    : 'bypassPermissions';

  const baseOpts = buildBaseOptions(sessionId, permMode, prompt, opts.userId);
  const stream = query({
    prompt,
    options: {
      ...baseOpts,
      maxTurns: opts.maxTurns || 50,
      sessionId,
    },
  });

  consumeStream(sessionId, stream);
  return sessionId;
}

/**
 * 在已有 session 上发送后续消息 (对话续接)
 * 使用 SDK 的 resume 机制加载历史对话并追加新 prompt
 * @param {string} sessionId - 已有 session 的 UUID
 * @param {string} prompt - 后续指令
 * @param {object} [opts] - 选项
 * @returns {boolean} 是否成功启动
 */
export function continueAgent(sessionId, prompt, opts = {}) {
  // Cannot continue if session is currently running -- guard + immediate claim to prevent TOCTOU
  if (activeAgents.has(sessionId)) {
    return false;
  }
  // Claim the slot immediately to block concurrent follow_up calls
  activeAgents.set(sessionId, { stream: null, timeoutId: null, stopped: false });

  const permMode = PERMISSION_MODES.includes(opts.permissionMode)
    ? opts.permissionMode
    : 'bypassPermissions';

  // Update session status back to running and append the follow-up prompt
  updateSessionStatus(sessionId, 'running');
  insertEvent(sessionId, 'user', { type: 'user', text: prompt, timestamp: Date.now() });

  const baseOpts = buildBaseOptions(sessionId, permMode, prompt, opts.userId);
  const stream = query({
    prompt,
    options: {
      ...baseOpts,
      maxTurns: opts.maxTurns || 50,
      resume: sessionId,
    },
  });

  // consumeStream will overwrite the activeAgents entry with the real stream/timeout
  consumeStream(sessionId, stream);
  return true;
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
