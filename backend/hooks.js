/**
 * Claude Code Agent SDK hook definitions.
 *
 * buildHooks(emitter, sessionId) returns a hooks configuration object
 * consumed by the SDK's `query()` call to intercept tool use, subagent
 * lifecycle, and session completion events.
 */

import { isAbsolute, normalize, resolve, sep } from 'node:path';
import { recordToolCall } from './mcpHealth.js';

export const BLOCKED_PATTERNS = [
  /rm\s+(-\w*\s+)*-rf\s+[/~]/,
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
  /\bcd\s+\.\.\//,
];

const ALLOWED_ABSOLUTE_PREFIXES = ['/usr/local/bin', '/usr/bin', '/bin', '/dev', '/tmp'];

function isPathInside(basePath, targetPath) {
  const normalizedBase = normalize(resolve(basePath));
  const normalizedTarget = normalize(resolve(targetPath));
  return (
    normalizedTarget === normalizedBase || normalizedTarget.startsWith(`${normalizedBase}${sep}`)
  );
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
    return `Blocked dangerous command: ${command}`;
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
  return {
    PreToolUse: [
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
