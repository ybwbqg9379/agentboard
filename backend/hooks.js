/**
 * Claude Code Agent SDK hook definitions.
 *
 * buildHooks(emitter, sessionId) returns a hooks configuration object
 * consumed by the SDK's `query()` call to intercept tool use, subagent
 * lifecycle, and session completion events.
 */

import { isAbsolute, normalize, resolve, sep } from 'node:path';
import { recordToolCall } from './mcpHealth.js';
import { validateToolCallSchema } from './schemaValidator.js';
import crypto from 'node:crypto';

// Loop Hash Detector State Map: sessionId -> { history: [{ tool, hash }], bailoutCount: number }
const sessionLoopState = new Map();

/** Clean up loop state for a session (call from agentManager on any termination path). */
export function cleanupSessionLoopState(sessionId) {
  sessionLoopState.delete(sessionId);
}

function hashArgs(args) {
  if (!args) return '';
  const str = typeof args === 'string' ? args : JSON.stringify(args);
  return crypto.createHash('md5').update(str).digest('hex');
}

export const BLOCKED_PATTERNS = [
  /rm\s+(-\w*\s+)*-rf\b/,
  /\|\s*(sh|bash|zsh)\b/,
  /\bsudo\b/,
  /\b(>\s*|tee\s+)(\/etc|\/usr|\/System|\/bin|\/sbin)\//,
  // Block reading sensitive files outside workspace
  /\bcat\s+.*~\/\.ssh\b/,
  /\bcat\s+.*~\/\.aws\b/,
  /\bcat\s+.*~\/\.gnupg\b/,
  /\bcat\s+.*\/etc\/passwd\b/,
  /\bcat\s+.*\/etc\/shadow\b/,
  /\bcat\s+.*\.env(?:\.\w+)?(?:\s|$)/,
  // Block data exfiltration via network tools
  /\|\s*(curl|wget|nc|ncat)\b/,
  /\b(curl|wget)\b.*--data/,
  /\b(curl|wget)\b.*-d\s/,
  // Block escaping to parent directories beyond workspace
  /\bcd\s+\.\.(?:\/|$|\s)/,

  // --- Phase 2: Destructive Oracle (上帝之眼破坏预言机) ---
  // SQL Disasters
  /\b(DROP|TRUNCATE|ALTER)\s+(TABLE|DATABASE|SCHEMA|ROLE|USER)\b/i,
  // Git Disasters
  /\bgit\s+reset\s+--hard\s+(HEAD~\d+|[A-Fa-f0-9]{5,})\b/,
  /\bgit\s+push\s+(-f|--force)\b/,
  /\bgit\s+(branch|tag)\s+-D\b/,
  // Docker Disasters
  /\bdocker\s+system\s+prune\s+-a\b/,
  /\bdocker\s+volume\s+rm\s+all\b/,
  /\bdocker\s+rm\s+-f\b.*ps\s+-a\s+-q/,
];

const ALLOWED_ABSOLUTE_PREFIXES = ['/usr/local/bin', '/usr/bin', '/bin', '/dev', '/tmp'];

export function isPathInside(basePath, targetPath) {
  const normalizedBase = normalize(resolve(basePath));
  const normalizedTarget = normalize(resolve(targetPath));
  return (
    normalizedTarget === normalizedBase || normalizedTarget.startsWith(`${normalizedBase}${sep}`)
  );
}

/** Resolve a tool path argument (absolute or relative) against workspace, then fence-check.
 *  File tools (Read/Write/Edit/Grep/Glob) are restricted to workspace only -- no /tmp, /dev. */
export function isFilePathAllowed(filePath, workspaceRoot) {
  if (typeof filePath !== 'string' || filePath.length === 0 || !workspaceRoot) return false;
  const resolved = isAbsolute(filePath)
    ? normalize(filePath)
    : normalize(resolve(workspaceRoot, filePath));
  return isPathInside(workspaceRoot, resolved);
}

export function extractAbsolutePaths(command) {
  if (typeof command !== 'string' || command.length === 0) return [];

  const matches = command.matchAll(/(^|[\s"'`=:([])(\/[^\s"'`|&;<>()[\]{}]+)/g);
  const paths = new Set();

  for (const match of matches) {
    const candidate = match[2]?.replace(/[),;]+$/, '');
    if (!candidate || candidate === '/' || candidate.startsWith('//') || !isAbsolute(candidate)) {
      continue;
    }
    paths.add(candidate);
  }

  return [...paths];
}

export function getPathFenceViolations(command, workspaceRoot) {
  if (typeof command !== 'string' || command.length === 0 || !workspaceRoot) return [];

  return extractAbsolutePaths(command).filter((absPath) => {
    if (isPathInside(workspaceRoot, absPath)) return false;
    return !ALLOWED_ABSOLUTE_PREFIXES.some((prefix) => isPathInside(prefix, absPath));
  });
}

export function getCommandBlockReason(command, workspaceRoot) {
  if (typeof command !== 'string' || command.trim().length === 0) return null;

  if (BLOCKED_PATTERNS.some((pattern) => pattern.test(command))) {
    return `[Harness Oracle blocked operation] Destructive action detected: ${command}. Switch to read-only tools or abort.`;
  }

  const violations = getPathFenceViolations(command, workspaceRoot);
  if (violations.length > 0) {
    return `Blocked command accessing paths outside workspace: ${violations.join(', ')}`;
  }

  return null;
}

export function isDangerous(command, workspaceRoot) {
  return getCommandBlockReason(command, workspaceRoot) !== null;
}

/**
 * Build a hooks configuration object for a single agent session.
 *
 * @param {import('node:events').EventEmitter} emitter - shared event bus
 * @param {string} sessionId - UUID of the current session
 * @param {string} [workspaceRoot] - Absolute workspace root for path fencing
 * @returns {object} hooks config accepted by the Claude Code Agent SDK
 */
export function buildHooks(emitter, sessionId, workspaceRoot) {
  if (!sessionLoopState.has(sessionId)) {
    sessionLoopState.set(sessionId, { history: [], bailoutCount: 0 });
  }

  return {
    PreToolUse: [
      {
        // 抓取全量 Tool 进行本地畸形参数自愈与死循环监控 (Phase 1 & Phase 2)
        hooks: [
          async (input) => {
            const toolName = input?.tool_name;
            const toolInput = input?.tool_input;
            if (!toolName) return {};

            // 1. Zod Schema Validator 兜底
            const validation = validateToolCallSchema(toolName, toolInput);
            if (!validation.valid) {
              console.warn(
                `[hooks] Zod validation failed (session=${sessionId}): ${validation.error}`,
              );
              emitter.emit('event', {
                sessionId,
                type: 'system',
                subtype: 'hook',
                content: { message: `Tool Schema Error: ${toolName}` },
                timestamp: Date.now(),
              });
              return {
                hookSpecificOutput: {
                  hookEventName: 'PreToolUse',
                  permissionDecision: 'deny',
                  permissionDecisionReason: validation.error,
                },
              };
            }

            // 2. File tool workspace fence (Read/Write/Edit/Grep/Glob)
            const FILE_TOOLS = {
              Read: 'file_path',
              Write: 'file_path',
              Edit: 'file_path',
              Grep: 'path',
              Glob: 'path',
            };
            if (workspaceRoot && FILE_TOOLS[toolName]) {
              const pathArg = toolInput?.[FILE_TOOLS[toolName]];
              if (pathArg && !isFilePathAllowed(pathArg, workspaceRoot)) {
                const msg = `Blocked ${toolName}: path "${pathArg}" is outside workspace`;
                console.warn(`[hooks] ${msg} (session=${sessionId})`);
                emitter.emit('event', {
                  sessionId,
                  type: 'system',
                  subtype: 'hook',
                  content: { message: msg },
                  timestamp: Date.now(),
                });
                return {
                  hookSpecificOutput: {
                    hookEventName: 'PreToolUse',
                    permissionDecision: 'deny',
                    permissionDecisionReason: msg,
                  },
                };
              }
            }

            // 3. Semantic Loop Hash Detector 防呆
            const state = sessionLoopState.get(sessionId);
            const callHash = hashArgs(toolInput);
            const currentCall = { tool: toolName, hash: callHash };

            // 将本次调用推入历史，保持最多 5 条
            state.history.push(currentCall);
            if (state.history.length > 5) state.history.shift();

            // 检测连续 3 次调用是否完全一致
            if (state.history.length >= 3) {
              const last3 = state.history.slice(-3);
              const isLoop = last3.every((c) => c.tool === toolName && c.hash === callHash);

              if (isLoop) {
                state.bailoutCount += 1;
                console.warn(
                  `[hooks] Malicious Loop Detected (session=${sessionId}, count=${state.bailoutCount})`,
                );

                // 终极熔断机制：在破壁指令下达后依然重复，强制退出
                if (state.bailoutCount >= 3) {
                  throw new Error(
                    'FATAL: Agent stuck in an unrecoverable infinite loop. Circuit breaker triggered.',
                  );
                }

                // 清空之前的短历史，避免立刻重复触发
                state.history = [];

                const bailoutMsg = `<harness_override>You have been stuck in an identical execution loop for the past 3 turns. The current strategy is fundamentally flawed. YOU MUST ABANDON this file/approach and attempt a completely different mitigation path to resolve the above error.</harness_override>`;

                emitter.emit('event', {
                  sessionId,
                  type: 'system',
                  subtype: 'hook',
                  content: { message: 'Semantic Loop Watchdog Triggered => Bailout Injection' },
                  timestamp: Date.now(),
                });

                return {
                  hookSpecificOutput: {
                    hookEventName: 'PreToolUse',
                    permissionDecision: 'deny',
                    permissionDecisionReason: bailoutMsg,
                  },
                };
              }
            }
            return {};
          },
        ],
      },
      {
        matcher: 'Bash',
        hooks: [
          async (input) => {
            try {
              const command = input?.tool_input?.command;
              const reason = getCommandBlockReason(command, workspaceRoot);
              if (reason) {
                console.warn(`[hooks] ${reason} (session=${sessionId})`);
                emitter.emit('event', {
                  sessionId,
                  type: 'system',
                  subtype: 'hook',
                  content: { message: reason },
                  timestamp: Date.now(),
                });
                return {
                  hookSpecificOutput: {
                    hookEventName: 'PreToolUse',
                    permissionDecision: 'deny',
                    permissionDecisionReason: reason,
                  },
                };
              }
              return {};
            } catch (err) {
              console.error(`[hooks] PreToolUse error (session=${sessionId}):`, err);
              return {};
            }
          },
        ],
      },
    ],

    PostToolUse: [
      {
        hooks: [
          async (input) => {
            try {
              const toolName = input?.tool_name;
              recordToolCall(toolName, true, null);
              emitter.emit('event', {
                sessionId,
                type: 'system',
                subtype: 'tool_complete',
                content: { tool: toolName, message: `Tool ${toolName} completed` },
                timestamp: Date.now(),
              });
            } catch (err) {
              console.error(`[hooks] PostToolUse error (session=${sessionId}):`, err);
            }
            return { async: true };
          },
        ],
      },
    ],

    PostToolUseFailure: [
      {
        hooks: [
          async (input) => {
            try {
              const toolName = input?.tool_name;
              const error = input?.error || 'unknown';
              recordToolCall(toolName, false, error);
              emitter.emit('event', {
                sessionId,
                type: 'system',
                subtype: 'tool_failed',
                content: { tool: toolName, error, message: `Tool ${toolName} failed: ${error}` },
                timestamp: Date.now(),
              });
            } catch (err) {
              console.error(`[hooks] PostToolUseFailure error (session=${sessionId}):`, err);
            }
            return { async: true };
          },
        ],
      },
    ],

    SubagentStart: [
      {
        hooks: [
          async (input) => {
            try {
              const agentName = input?.agent_name;
              console.log(`[hooks] Subagent started: ${agentName} (session=${sessionId})`);
              emitter.emit('event', {
                sessionId,
                type: 'system',
                subtype: 'subagent',
                content: { message: `Delegated to subagent: ${agentName}`, agent: agentName },
                timestamp: Date.now(),
              });
            } catch (err) {
              console.error(`[hooks] SubagentStart error (session=${sessionId}):`, err);
            }
            return { async: true };
          },
        ],
      },
    ],

    SubagentStop: [
      {
        hooks: [
          async (input) => {
            try {
              const agentType = input?.agent_type;
              emitter.emit('event', {
                sessionId,
                type: 'system',
                subtype: 'subagent_stop',
                content: {
                  message: `Subagent completed: ${agentType}`,
                  agent: agentType,
                },
                timestamp: Date.now(),
              });
            } catch (err) {
              console.error(`[hooks] SubagentStop error (session=${sessionId}):`, err);
            }
            return { async: true };
          },
        ],
      },
    ],

    PermissionDenied: [
      {
        hooks: [
          async (input) => {
            try {
              const toolName = input?.tool_name;
              const reason = input?.reason || 'denied';
              emitter.emit('event', {
                sessionId,
                type: 'system',
                subtype: 'permission_denied',
                content: {
                  tool: toolName,
                  reason,
                  message: `Permission denied: ${toolName} -- ${reason}`,
                },
                timestamp: Date.now(),
              });
            } catch (err) {
              console.error(`[hooks] PermissionDenied error (session=${sessionId}):`, err);
            }
            return { async: true };
          },
        ],
      },
    ],

    UserPromptSubmit: [
      {
        hooks: [
          async (input) => {
            try {
              const prompt = input?.prompt || '';
              // Log prompt submission for audit trail
              emitter.emit('event', {
                sessionId,
                type: 'system',
                subtype: 'prompt_submitted',
                content: {
                  message: `Prompt received (${prompt.length} chars)`,
                  length: prompt.length,
                },
                timestamp: Date.now(),
              });
            } catch (err) {
              console.error(`[hooks] UserPromptSubmit error (session=${sessionId}):`, err);
            }
            return { async: true };
          },
        ],
      },
    ],

    Stop: [
      {
        hooks: [
          async () => {
            try {
              console.log(`[hooks] Agent stopped (session=${sessionId})`);
            } catch (err) {
              console.error(`[hooks] Stop error (session=${sessionId}):`, err);
            }
            return { async: true };
          },
        ],
      },
    ],

    PreCompact: [
      {
        hooks: [
          async () => {
            try {
              emitter.emit('event', {
                sessionId,
                type: 'system',
                subtype: 'pre_compact',
                content: { message: 'Context window compaction starting' },
                timestamp: Date.now(),
              });
            } catch (err) {
              console.error(`[hooks] PreCompact error (session=${sessionId}):`, err);
            }
            return { async: true };
          },
        ],
      },
    ],

    PostCompact: [
      {
        hooks: [
          async () => {
            try {
              emitter.emit('event', {
                sessionId,
                type: 'system',
                subtype: 'post_compact',
                content: { message: 'Context window compaction completed' },
                timestamp: Date.now(),
              });
            } catch (err) {
              console.error(`[hooks] PostCompact error (session=${sessionId}):`, err);
            }
            return { async: true };
          },
        ],
      },
    ],

    SessionStart: [
      {
        hooks: [
          async () => {
            try {
              emitter.emit('event', {
                sessionId,
                type: 'system',
                subtype: 'session_start',
                content: { message: 'Session initialized' },
                timestamp: Date.now(),
              });
            } catch (err) {
              console.error(`[hooks] SessionStart error (session=${sessionId}):`, err);
            }
            return { async: true };
          },
        ],
      },
    ],

    SessionEnd: [
      {
        hooks: [
          async () => {
            try {
              emitter.emit('event', {
                sessionId,
                type: 'system',
                subtype: 'session_end',
                content: { message: 'Session ended' },
                timestamp: Date.now(),
              });
              sessionLoopState.delete(sessionId);
            } catch (err) {
              console.error(`[hooks] SessionEnd error (session=${sessionId}):`, err);
            }
            return { async: true };
          },
        ],
      },
    ],
  };
}
