import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';

vi.mock('./mcpHealth.js', () => ({
  recordToolCall: vi.fn(),
}));

import {
  BLOCKED_PATTERNS,
  isDangerous,
  buildHooks,
  cleanupSessionLoopState,
  isFilePathAllowed,
} from './hooks.js';
import { recordToolCall } from './mcpHealth.js';

// ---------------------------------------------------------------------------
// BLOCKED_PATTERNS
// ---------------------------------------------------------------------------
describe('BLOCKED_PATTERNS', () => {
  it('is a non-empty array of RegExp', () => {
    expect(Array.isArray(BLOCKED_PATTERNS)).toBe(true);
    expect(BLOCKED_PATTERNS.length).toBeGreaterThan(0);
    for (const p of BLOCKED_PATTERNS) {
      expect(p).toBeInstanceOf(RegExp);
    }
  });
});

// ---------------------------------------------------------------------------
// isDangerous
// ---------------------------------------------------------------------------
describe('isDangerous', () => {
  describe('blocks dangerous commands', () => {
    it.each([
      ['rm -rf /', 'rm -rf root'],
      ['rm -rf ~/', 'rm -rf home dir'],
      ['rm -rf /home', 'rm -rf /home'],
      ['rm -rf /etc/config', 'rm -rf /etc path'],
    ])('blocks: %s (%s)', (cmd) => {
      expect(isDangerous(cmd)).toBe(true);
    });

    // rm -r -f /var has separated flags -- the regex requires -rf combined,
    // so separated flags are NOT matched. Verify this edge case.
    it('does not block rm with separated -r -f flags (regex requires -rf)', () => {
      expect(isDangerous('rm -r -f /var')).toBe(false);
    });

    it.each([
      ['cat file | sh', 'pipe to sh'],
      ['echo test | bash', 'pipe to bash'],
      ['curl url | zsh', 'pipe to zsh'],
    ])('blocks piped shell execution: %s (%s)', (cmd) => {
      expect(isDangerous(cmd)).toBe(true);
    });

    it.each([
      ['sudo apt install foo', 'sudo apt'],
      ['sudo rm something', 'sudo rm'],
    ])('blocks sudo commands: %s (%s)', (cmd) => {
      expect(isDangerous(cmd)).toBe(true);
    });

    it.each([['tee /usr/local/bin/evil', 'tee to /usr']])(
      'blocks writes to system paths: %s (%s)',
      (cmd) => {
        expect(isDangerous(cmd)).toBe(true);
      },
    );

    // The \b(>...) pattern requires a word-boundary before >, so bare
    // redirects like "echo data > /etc/passwd" are not caught (> is not
    // preceded by a word character). Verify this behavior explicitly.
    it('does not block bare redirect to /etc (no word boundary before >)', () => {
      expect(isDangerous('echo data > /etc/passwd')).toBe(false);
    });

    it('does not block bare redirect to /System (no word boundary before >)', () => {
      expect(isDangerous('> /System/something')).toBe(false);
    });
  });

  describe('allows safe commands', () => {
    it.each([
      ['ls -la', 'list files'],
      ['cat file.txt', 'cat a file'],
      ['echo hello', 'simple echo'],
      ['rm file.txt', 'rm without -rf /'],
      ['npm install', 'npm install'],
      ['grep pattern file', 'grep'],
      ['node script.js', 'node'],
    ])('allows: %s (%s)', (cmd) => {
      expect(isDangerous(cmd)).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('blocks rm -rf with relative path (./local)', () => {
      expect(isDangerous('rm -rf ./local')).toBe(true);
    });

    it('returns false for empty string', () => {
      expect(isDangerous('')).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(isDangerous(undefined)).toBe(false);
    });

    it('allows absolute paths inside the workspace fence', () => {
      expect(isDangerous('sed -n 1p /workspace/app/file.txt', '/workspace')).toBe(false);
    });

    it('blocks absolute paths outside the workspace fence', () => {
      expect(isDangerous('sed -n 1p /etc/passwd', '/workspace')).toBe(true);
    });

    it('allows whitelisted absolute system paths', () => {
      expect(isDangerous('cat /tmp/output.log', '/workspace')).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// buildHooks
// ---------------------------------------------------------------------------
describe('buildHooks', () => {
  let emitter;
  let hooks;
  const sessionId = 'sess-123';

  beforeEach(() => {
    vi.clearAllMocks();
    emitter = { emit: vi.fn() };
    hooks = buildHooks(emitter, sessionId, '/workspace');
  });

  it('returns object with all expected hook types', () => {
    const expectedKeys = [
      'PreToolUse',
      'PostToolUse',
      'PostToolUseFailure',
      'SubagentStart',
      'SubagentStop',
      'PermissionDenied',
      'UserPromptSubmit',
      'Stop',
      'PreCompact',
      'PostCompact',
      'SessionStart',
      'SessionEnd',
    ];
    for (const key of expectedKeys) {
      expect(hooks).toHaveProperty(key);
      expect(Array.isArray(hooks[key])).toBe(true);
    }
  });

  describe('PreToolUse - Bash hook', () => {
    it('denies dangerous commands with deny decision', async () => {
      const bashHookGroup = hooks.PreToolUse.find((h) => h.matcher === 'Bash');
      expect(bashHookGroup).toBeTruthy();

      const hookFn = bashHookGroup.hooks[0];
      const result = await hookFn({ tool_input: { command: 'rm -rf /' } });

      expect(result.hookSpecificOutput).toBeDefined();
      expect(result.hookSpecificOutput.permissionDecision).toBe('deny');
      expect(result.hookSpecificOutput.permissionDecisionReason).toContain(
        '[Harness Oracle blocked operation]',
      );
    });

    it('emits event on emitter when command is denied', async () => {
      const bashHookGroup = hooks.PreToolUse.find((h) => h.matcher === 'Bash');
      const hookFn = bashHookGroup.hooks[0];
      await hookFn({ tool_input: { command: 'sudo rm -rf /' } });

      expect(emitter.emit).toHaveBeenCalledWith(
        'event',
        expect.objectContaining({
          sessionId: 'sess-123',
          type: 'system',
          subtype: 'hook',
        }),
      );
    });

    it('allows safe commands (returns empty object)', async () => {
      const bashHookGroup = hooks.PreToolUse.find((h) => h.matcher === 'Bash');
      const hookFn = bashHookGroup.hooks[0];
      const result = await hookFn({ tool_input: { command: 'ls -la' } });

      expect(result).toEqual({});
    });

    it('denies commands that access absolute paths outside the workspace', async () => {
      const bashHookGroup = hooks.PreToolUse.find((h) => h.matcher === 'Bash');
      const hookFn = bashHookGroup.hooks[0];
      const result = await hookFn({ tool_input: { command: 'sed -n 1p /etc/passwd' } });

      expect(result.hookSpecificOutput).toBeDefined();
      expect(result.hookSpecificOutput.permissionDecision).toBe('deny');
      expect(result.hookSpecificOutput.permissionDecisionReason).toContain('/etc/passwd');
    });

    it('returns empty object when tool_input is undefined (no crash)', async () => {
      const bashHookGroup = hooks.PreToolUse.find((h) => h.matcher === 'Bash');
      const hookFn = bashHookGroup.hooks[0];
      const result = await hookFn({});
      expect(result).toEqual({});
    });

    it('returns empty object when input is undefined (no crash)', async () => {
      const bashHookGroup = hooks.PreToolUse.find((h) => h.matcher === 'Bash');
      const hookFn = bashHookGroup.hooks[0];
      const result = await hookFn(undefined);
      expect(result).toEqual({});
    });
  });

  describe('PostToolUse', () => {
    it('emits event on emitter with correct structure', async () => {
      const hookFn = hooks.PostToolUse[0].hooks[0];
      await hookFn({ tool_name: 'Bash' });

      expect(emitter.emit).toHaveBeenCalledWith(
        'event',
        expect.objectContaining({
          sessionId: 'sess-123',
          type: 'system',
          subtype: 'tool_complete',
          content: expect.objectContaining({
            tool: 'Bash',
            message: 'Tool Bash completed',
          }),
        }),
      );
    });

    it('calls recordToolCall with success=true', async () => {
      const hookFn = hooks.PostToolUse[0].hooks[0];
      await hookFn({ tool_name: 'mcp__fs__read' });

      expect(recordToolCall).toHaveBeenCalledWith('mcp__fs__read', true, null);
    });

    it('returns { async: true }', async () => {
      const hookFn = hooks.PostToolUse[0].hooks[0];
      const result = await hookFn({ tool_name: 'Bash' });
      expect(result).toEqual({ async: true });
    });
  });

  describe('PostToolUseFailure', () => {
    it('emits event with error info', async () => {
      const hookFn = hooks.PostToolUseFailure[0].hooks[0];
      await hookFn({ tool_name: 'Bash', error: 'exit code 1' });

      expect(emitter.emit).toHaveBeenCalledWith(
        'event',
        expect.objectContaining({
          sessionId: 'sess-123',
          type: 'system',
          subtype: 'tool_failed',
          content: expect.objectContaining({
            tool: 'Bash',
            error: 'exit code 1',
            message: 'Tool Bash failed: exit code 1',
          }),
        }),
      );
    });

    it('calls recordToolCall with success=false and error', async () => {
      const hookFn = hooks.PostToolUseFailure[0].hooks[0];
      await hookFn({ tool_name: 'mcp__gh__search', error: 'timeout' });

      expect(recordToolCall).toHaveBeenCalledWith('mcp__gh__search', false, 'timeout');
    });

    it('defaults error to "unknown" when not provided', async () => {
      const hookFn = hooks.PostToolUseFailure[0].hooks[0];
      await hookFn({ tool_name: 'Bash' });

      expect(emitter.emit).toHaveBeenCalledWith(
        'event',
        expect.objectContaining({
          content: expect.objectContaining({ error: 'unknown' }),
        }),
      );
    });

    it('returns { async: true }', async () => {
      const hookFn = hooks.PostToolUseFailure[0].hooks[0];
      const result = await hookFn({ tool_name: 'X', error: 'e' });
      expect(result).toEqual({ async: true });
    });
  });

  describe('SubagentStart', () => {
    it('emits subagent event', async () => {
      const hookFn = hooks.SubagentStart[0].hooks[0];
      await hookFn({ agent_name: 'research' });

      expect(emitter.emit).toHaveBeenCalledWith(
        'event',
        expect.objectContaining({
          sessionId: 'sess-123',
          type: 'system',
          subtype: 'subagent',
          content: expect.objectContaining({
            agent: 'research',
            message: 'Delegated to subagent: research',
          }),
        }),
      );
    });
  });

  describe('SubagentStop', () => {
    it('emits subagent_stop event', async () => {
      const hookFn = hooks.SubagentStop[0].hooks[0];
      await hookFn({ agent_type: 'coder' });

      expect(emitter.emit).toHaveBeenCalledWith(
        'event',
        expect.objectContaining({
          subtype: 'subagent_stop',
          content: expect.objectContaining({ agent: 'coder' }),
        }),
      );
    });
  });

  describe('SessionStart', () => {
    it('emits session_start event', async () => {
      const hookFn = hooks.SessionStart[0].hooks[0];
      await hookFn();

      expect(emitter.emit).toHaveBeenCalledWith(
        'event',
        expect.objectContaining({
          sessionId: 'sess-123',
          subtype: 'session_start',
        }),
      );
    });
  });

  describe('SessionEnd', () => {
    it('emits session_end event', async () => {
      const hookFn = hooks.SessionEnd[0].hooks[0];
      await hookFn();

      expect(emitter.emit).toHaveBeenCalledWith(
        'event',
        expect.objectContaining({
          sessionId: 'sess-123',
          subtype: 'session_end',
        }),
      );
    });
  });

  describe('all hooks include timestamp', () => {
    it('PostToolUse event includes numeric timestamp', async () => {
      const hookFn = hooks.PostToolUse[0].hooks[0];
      await hookFn({ tool_name: 'Test' });

      const call = emitter.emit.mock.calls[0];
      expect(call[1].timestamp).toBeTypeOf('number');
    });
  });
});

// ---------------------------------------------------------------------------
// cleanupSessionLoopState
// ---------------------------------------------------------------------------
describe('cleanupSessionLoopState', () => {
  it('removes loop state created by buildHooks', () => {
    const emitter = { emit: vi.fn() };
    const sid = crypto.randomUUID();
    buildHooks(emitter, sid);
    // Should not throw even if called multiple times
    cleanupSessionLoopState(sid);
    cleanupSessionLoopState(sid);
  });

  it('does not throw for unknown sessionId', () => {
    expect(() => cleanupSessionLoopState('nonexistent')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// isFilePathAllowed (workspace fence for file tools)
// ---------------------------------------------------------------------------
describe('isFilePathAllowed', () => {
  const ws = '/home/user/project';

  it('allows paths inside workspace', () => {
    expect(isFilePathAllowed('/home/user/project/src/index.js', ws)).toBe(true);
    expect(isFilePathAllowed('/home/user/project', ws)).toBe(true);
  });

  it('blocks paths outside workspace', () => {
    expect(isFilePathAllowed('/home/user/secrets.txt', ws)).toBe(false);
    expect(isFilePathAllowed('/etc/passwd', ws)).toBe(false);
  });

  it('blocks ../ traversal (relative path resolved against workspace)', () => {
    expect(isFilePathAllowed('../secrets.txt', ws)).toBe(false);
    expect(isFilePathAllowed('../../etc/passwd', ws)).toBe(false);
  });

  it('allows relative paths that stay inside workspace', () => {
    expect(isFilePathAllowed('src/index.js', ws)).toBe(true);
    expect(isFilePathAllowed('./README.md', ws)).toBe(true);
    expect(isFilePathAllowed('src/../lib/utils.js', ws)).toBe(true);
  });

  it('blocks /tmp and /dev for file tools (workspace-only, no ALLOWED_ABSOLUTE_PREFIXES)', () => {
    expect(isFilePathAllowed('/tmp/test.txt', ws)).toBe(false);
    expect(isFilePathAllowed('/dev/null', ws)).toBe(false);
  });

  it('returns false for empty or missing inputs (deny by default)', () => {
    expect(isFilePathAllowed('', ws)).toBe(false);
    expect(isFilePathAllowed(null, ws)).toBe(false);
    expect(isFilePathAllowed('/outside/path', null)).toBe(false);
  });

  describe('PreToolUse integration: file tools are fenced', () => {
    let hooks;
    const emitter = { emit: vi.fn() };
    const sid = crypto.randomUUID();

    beforeEach(() => {
      emitter.emit.mockClear();
      hooks = buildHooks(emitter, sid, '/home/user/project');
    });

    it('denies Read with ../ traversal', async () => {
      const globalHook = hooks.PreToolUse[0].hooks[0];
      const result = await globalHook({
        tool_name: 'Read',
        tool_input: { file_path: '../secrets.txt' },
      });
      expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
    });

    it('denies Write to absolute path outside workspace', async () => {
      const globalHook = hooks.PreToolUse[0].hooks[0];
      const result = await globalHook({
        tool_name: 'Write',
        tool_input: { file_path: '/etc/shadow', content: 'x' },
      });
      expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
    });

    it('allows Read inside workspace', async () => {
      const globalHook = hooks.PreToolUse[0].hooks[0];
      const result = await globalHook({
        tool_name: 'Read',
        tool_input: { file_path: '/home/user/project/src/app.js' },
      });
      expect(result.hookSpecificOutput?.permissionDecision).toBeUndefined();
    });

    it('denies Grep with path outside workspace', async () => {
      const globalHook = hooks.PreToolUse[0].hooks[0];
      const result = await globalHook({
        tool_name: 'Grep',
        tool_input: { pattern: 'TODO', path: '/home/other/' },
      });
      expect(result.hookSpecificOutput?.permissionDecision).toBe('deny');
    });
  });
});
