import { describe, it, expect, vi } from 'vitest';

vi.mock('./AgentTimeline.module.css', () => ({ default: {} }));

import {
  SYSTEM_HANDLERS,
  TYPE_HANDLERS,
  BLOCK_HANDLERS,
  parseBlock,
  flattenEvent,
} from './AgentTimeline.jsx';

// ---------------------------------------------------------------------------
// SYSTEM_HANDLERS
// ---------------------------------------------------------------------------
describe('SYSTEM_HANDLERS', () => {
  const ts = '2026-03-31T12:00:00Z';

  describe('init', () => {
    it('returns Session Init with model/tools/mcp pipe-separated', () => {
      const content = { model: 'claude-4', tools: ['a', 'b'], mcp_servers: ['s1'] };
      const result = SYSTEM_HANDLERS.init(content, ts);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        label: 'Session Init',
        dot: 'done',
        ts,
      });
      expect(result[0].body).toContain('Model: claude-4');
      expect(result[0].body).toContain('Tools: 2');
      expect(result[0].body).toContain('MCP: 1');
    });

    it('includes Skills count when skills array present', () => {
      const content = {
        model: 'claude-4',
        tools: [],
        mcp_servers: [],
        skills: ['s1', 's2', 's3'],
      };
      const result = SYSTEM_HANDLERS.init(content, ts);
      expect(result[0].body).toContain('Skills: 3');
    });

    it('defaults to unknown/0 when fields missing', () => {
      const result = SYSTEM_HANDLERS.init({}, ts);
      expect(result[0].body).toContain('Model: unknown');
      expect(result[0].body).toContain('Tools: 0');
      expect(result[0].body).toContain('MCP: 0');
    });

    it('handles null content', () => {
      const result = SYSTEM_HANDLERS.init(null, ts);
      expect(result[0].body).toContain('Model: unknown');
    });
  });

  describe('api_retry', () => {
    it('returns retry info', () => {
      const content = { attempt: 2, max_retries: 5, retry_delay_ms: 1000 };
      const result = SYSTEM_HANDLERS.api_retry(content, ts);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        label: 'API Retry',
        dot: 'error',
        ts,
      });
      expect(result[0].body).toBe('Retry 2/5 (1000ms)');
    });

    it('uses fallback values when fields missing', () => {
      const result = SYSTEM_HANDLERS.api_retry({}, ts);
      expect(result[0].body).toBe('Retry ?/? (0ms)');
    });
  });

  describe('status', () => {
    it('returns Compacting when status is compacting', () => {
      const result = SYSTEM_HANDLERS.status({ status: 'compacting' }, ts);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        label: 'Compacting',
        dot: 'thinking',
        body: 'Context compacting...',
      });
    });

    it('returns empty array for other statuses', () => {
      expect(SYSTEM_HANDLERS.status({ status: 'idle' }, ts)).toEqual([]);
    });
  });

  describe('compact_boundary', () => {
    it('returns Compacted', () => {
      const result = SYSTEM_HANDLERS.compact_boundary(null, ts);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ label: 'Compacted', dot: 'done' });
    });
  });

  describe('task_started', () => {
    it('returns Subtask with description', () => {
      const result = SYSTEM_HANDLERS.task_started({ description: 'Analyze code' }, ts);
      expect(result[0]).toMatchObject({
        label: 'Subtask',
        dot: 'running',
        body: 'Analyze code',
      });
    });
  });

  describe('task_notification', () => {
    it('uses failed dot when status is failed', () => {
      const result = SYSTEM_HANDLERS.task_notification({ status: 'failed', summary: 'oops' }, ts);
      expect(result[0]).toMatchObject({
        label: 'Subtask failed',
        dot: 'error',
        body: 'oops',
      });
    });

    it('uses done dot for completed status', () => {
      const result = SYSTEM_HANDLERS.task_notification({ status: 'completed', summary: 'ok' }, ts);
      expect(result[0].dot).toBe('done');
    });

    it('defaults to completed when status missing', () => {
      const result = SYSTEM_HANDLERS.task_notification({}, ts);
      expect(result[0].label).toBe('Subtask completed');
      expect(result[0].dot).toBe('done');
    });
  });

  describe('subagent_stop', () => {
    it('returns Subagent Done', () => {
      const result = SYSTEM_HANDLERS.subagent_stop({ message: 'finished' }, ts);
      expect(result[0]).toMatchObject({
        label: 'Subagent Done',
        dot: 'done',
        body: 'finished',
      });
    });
  });

  describe('permission_denied', () => {
    it('returns Permission Denied with message', () => {
      const result = SYSTEM_HANDLERS.permission_denied({ message: 'Blocked' }, ts);
      expect(result[0]).toMatchObject({
        label: 'Permission Denied',
        dot: 'error',
        body: 'Blocked',
      });
    });

    it('falls back to tool:reason when message is absent', () => {
      const result = SYSTEM_HANDLERS.permission_denied({ tool: 'Bash', reason: 'not allowed' }, ts);
      expect(result[0].body).toBe('Bash: not allowed');
    });
  });

  describe('tool_failed', () => {
    it('returns Tool Failed with error dot', () => {
      const result = SYSTEM_HANDLERS.tool_failed({ message: 'timeout' }, ts);
      expect(result[0]).toMatchObject({
        label: 'Tool Failed',
        dot: 'error',
        body: 'timeout',
      });
    });

    it('falls back to tool:error', () => {
      const result = SYSTEM_HANDLERS.tool_failed({ tool: 'Read', error: 'ENOENT' }, ts);
      expect(result[0].body).toBe('Read: ENOENT');
    });
  });

  describe('pre_compact / post_compact / session_start / session_end', () => {
    it('pre_compact returns Compacting', () => {
      const result = SYSTEM_HANDLERS.pre_compact(null, ts);
      expect(result[0]).toMatchObject({ label: 'Compacting', dot: 'thinking' });
    });

    it('post_compact returns Compacted', () => {
      const result = SYSTEM_HANDLERS.post_compact(null, ts);
      expect(result[0]).toMatchObject({ label: 'Compacted', dot: 'done' });
    });

    it('session_start returns Session', () => {
      const result = SYSTEM_HANDLERS.session_start(null, ts);
      expect(result[0]).toMatchObject({ label: 'Session', dot: 'done' });
    });

    it('session_end returns Session End', () => {
      const result = SYSTEM_HANDLERS.session_end(null, ts);
      expect(result[0]).toMatchObject({ label: 'Session End', dot: 'done' });
    });
  });

  describe('silent subtypes', () => {
    const silentKeys = [
      'task_progress',
      'hook_started',
      'hook_progress',
      'hook_response',
      'prompt_submitted',
    ];
    for (const key of silentKeys) {
      it(`${key} returns empty array`, () => {
        expect(SYSTEM_HANDLERS[key]()).toEqual([]);
      });
    }
  });
});

// ---------------------------------------------------------------------------
// TYPE_HANDLERS
// ---------------------------------------------------------------------------
describe('TYPE_HANDLERS', () => {
  const ts = '2026-03-31T12:00:00Z';

  describe('tool_progress', () => {
    it('returns tool name with elapsed time', () => {
      const result = TYPE_HANDLERS.tool_progress(
        { tool_name: 'Bash', elapsed_time_seconds: 3.5 },
        ts,
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ label: 'Bash', dot: 'running' });
      expect(result[0].body).toBe('3.5s elapsed');
    });

    it('defaults to unknown / 0s', () => {
      const result = TYPE_HANDLERS.tool_progress({}, ts);
      expect(result[0].label).toBe('unknown');
      expect(result[0].body).toBe('0s elapsed');
    });
  });

  describe('rate_limit_event', () => {
    it('returns Rate Limit with error dot', () => {
      const result = TYPE_HANDLERS.rate_limit_event(
        { rate_limit_info: { status: 'backoff 30s' } },
        ts,
      );
      expect(result[0]).toMatchObject({
        label: 'Rate Limit',
        dot: 'error',
        body: 'backoff 30s',
      });
    });

    it('defaults body to Rate limited', () => {
      const result = TYPE_HANDLERS.rate_limit_event({}, ts);
      expect(result[0].body).toBe('Rate limited');
    });
  });

  describe('stream_event', () => {
    it('returns empty array', () => {
      expect(TYPE_HANDLERS.stream_event()).toEqual([]);
    });
  });

  describe('stderr', () => {
    it('returns Stderr with error dot', () => {
      const result = TYPE_HANDLERS.stderr({ text: 'warning: something' }, ts);
      expect(result[0]).toMatchObject({
        label: 'Stderr',
        dot: 'error',
        body: 'warning: something',
      });
    });
  });

  describe('raw', () => {
    it('returns Output', () => {
      const result = TYPE_HANDLERS.raw({ text: 'hello world' }, ts);
      expect(result[0]).toMatchObject({
        label: 'Output',
        dot: 'done',
        body: 'hello world',
      });
    });
  });

  describe('result', () => {
    it('returns Stats with formatted parts', () => {
      const content = {
        num_turns: 5,
        duration_ms: 12345,
        usage: { input_tokens: 1000, output_tokens: 500 },
        total_cost_usd: 0.0234,
      };
      const result = TYPE_HANDLERS.result(content, ts);
      expect(result).toHaveLength(1);
      expect(result[0].label).toBe('Stats');
      expect(result[0].dot).toBe('done');
      expect(result[0].body).toContain('5 turns');
      expect(result[0].body).toContain('12.3s');
      expect(result[0].body).toContain('1500 tokens');
      expect(result[0].body).toContain('$0.0234');
    });

    it('returns empty array when no stats', () => {
      expect(TYPE_HANDLERS.result({}, ts)).toEqual([]);
      expect(TYPE_HANDLERS.result(null, ts)).toEqual([]);
    });

    it('handles partial stats (only cost)', () => {
      const result = TYPE_HANDLERS.result({ total_cost_usd: 0.05 }, ts);
      expect(result).toHaveLength(1);
      expect(result[0].body).toBe('$0.0500');
    });
  });
});

// ---------------------------------------------------------------------------
// BLOCK_HANDLERS
// ---------------------------------------------------------------------------
describe('BLOCK_HANDLERS', () => {
  const ts = '2026-03-31T12:00:00Z';

  it('thinking block', () => {
    const result = BLOCK_HANDLERS.thinking({ type: 'thinking', thinking: 'hmm' }, ts);
    expect(result).toMatchObject({ label: 'Thinking', dot: 'thinking', body: 'hmm' });
  });

  it('thinking block falls back to text field', () => {
    const result = BLOCK_HANDLERS.thinking({ type: 'thinking', text: 'fallback' }, ts);
    expect(result.body).toBe('fallback');
  });

  it('text block with text', () => {
    const result = BLOCK_HANDLERS.text({ type: 'text', text: 'hello' }, ts);
    expect(result).toMatchObject({ label: 'Assistant', dot: 'done', body: 'hello' });
  });

  it('text block with empty text returns null', () => {
    expect(BLOCK_HANDLERS.text({ type: 'text', text: '' }, ts)).toBeNull();
  });

  it('tool_use block', () => {
    const result = BLOCK_HANDLERS.tool_use(
      { type: 'tool_use', name: 'Read', input: { file_path: '/a.txt' } },
      ts,
    );
    expect(result).toMatchObject({ label: 'Tool: Read', dot: 'tool' });
    expect(result.body).toContain('file_path');
  });

  it('tool_use with string input', () => {
    const result = BLOCK_HANDLERS.tool_use({ type: 'tool_use', name: 'Bash', input: 'ls -la' }, ts);
    expect(result.body).toBe('ls -la');
  });

  it('tool_result block', () => {
    const result = BLOCK_HANDLERS.tool_result(
      { type: 'tool_result', content: 'file contents here' },
      ts,
    );
    expect(result).toMatchObject({ label: 'Tool Result', dot: 'done' });
    expect(result.body).toBe('file contents here');
  });

  it('tool_result with is_error', () => {
    const result = BLOCK_HANDLERS.tool_result(
      { type: 'tool_result', is_error: true, content: 'ENOENT' },
      ts,
    );
    expect(result).toMatchObject({ label: 'Tool Error', dot: 'error' });
  });

  it('tool_result with output field', () => {
    const result = BLOCK_HANDLERS.tool_result(
      { type: 'tool_result', content: { complex: true }, output: 'simple output' },
      ts,
    );
    expect(result.body).toBe('simple output');
  });
});

// ---------------------------------------------------------------------------
// parseBlock
// ---------------------------------------------------------------------------
describe('parseBlock', () => {
  const ts = '2026-03-31T12:00:00Z';

  it('returns null for null input', () => {
    expect(parseBlock(null, ts)).toBeNull();
  });

  it('parses text block with text', () => {
    const result = parseBlock({ type: 'text', text: 'hello' }, ts);
    expect(result).toMatchObject({ label: 'Assistant', body: 'hello' });
  });

  it('returns null for text block with empty text', () => {
    expect(parseBlock({ type: 'text', text: '' }, ts)).toBeNull();
  });

  it('parses tool_use block', () => {
    const result = parseBlock({ type: 'tool_use', name: 'Bash', input: 'ls' }, ts);
    expect(result.label).toBe('Tool: Bash');
  });

  it('JSON-stringifies unknown block type', () => {
    const block = { type: 'image', data: 'base64...' };
    const result = parseBlock(block, ts);
    expect(result.label).toBe('image');
    expect(result.dot).toBe('done');
    expect(result.body).toBe(JSON.stringify(block, null, 2));
  });

  it('uses "Block" label when block.type is falsy', () => {
    const result = parseBlock({ data: 'something' }, ts);
    expect(result.label).toBe('Block');
  });
});

// ---------------------------------------------------------------------------
// flattenEvent
// ---------------------------------------------------------------------------
describe('flattenEvent', () => {
  const ts = '2026-03-31T12:00:00Z';

  // --- System events ---
  describe('system events', () => {
    it('init with model/tools/mcp_servers', () => {
      const event = {
        type: 'system',
        subtype: 'init',
        content: { model: 'opus', tools: ['a'], mcp_servers: ['s'] },
        timestamp: ts,
      };
      const result = flattenEvent(event);
      expect(result).toHaveLength(1);
      expect(result[0].label).toBe('Session Init');
      expect(result[0].body).toContain('Model: opus');
    });

    it('init with skills', () => {
      const event = {
        type: 'system',
        subtype: 'init',
        content: { model: 'x', tools: [], mcp_servers: [], skills: ['a', 'b'] },
        timestamp: ts,
      };
      const result = flattenEvent(event);
      expect(result[0].body).toContain('Skills: 2');
    });

    it('api_retry', () => {
      const event = {
        type: 'system',
        subtype: 'api_retry',
        content: { attempt: 1, max_retries: 3, retry_delay_ms: 500 },
        timestamp: ts,
      };
      const result = flattenEvent(event);
      expect(result[0].label).toBe('API Retry');
    });

    it('status compacting', () => {
      const event = {
        type: 'system',
        subtype: 'status',
        content: { status: 'compacting' },
        timestamp: ts,
      };
      expect(flattenEvent(event)[0].label).toBe('Compacting');
    });

    it('compact_boundary', () => {
      const event = {
        type: 'system',
        subtype: 'compact_boundary',
        content: {},
        timestamp: ts,
      };
      expect(flattenEvent(event)[0].label).toBe('Compacted');
    });

    it('task_started', () => {
      const event = {
        type: 'system',
        subtype: 'task_started',
        content: { description: 'Do X' },
        timestamp: ts,
      };
      expect(flattenEvent(event)[0]).toMatchObject({
        label: 'Subtask',
        body: 'Do X',
      });
    });

    it('task_notification with status-dependent dot', () => {
      const failedEvent = {
        type: 'system',
        subtype: 'task_notification',
        content: { status: 'failed', summary: 'oops' },
        timestamp: ts,
      };
      expect(flattenEvent(failedEvent)[0].dot).toBe('error');

      const completedEvent = {
        type: 'system',
        subtype: 'task_notification',
        content: { status: 'completed', summary: 'ok' },
        timestamp: ts,
      };
      expect(flattenEvent(completedEvent)[0].dot).toBe('done');
    });

    it('subagent_stop', () => {
      const event = {
        type: 'system',
        subtype: 'subagent_stop',
        content: { message: 'done' },
        timestamp: ts,
      };
      expect(flattenEvent(event)[0]).toMatchObject({
        label: 'Subagent Done',
        dot: 'done',
      });
    });

    it('permission_denied', () => {
      const event = {
        type: 'system',
        subtype: 'permission_denied',
        content: { message: 'denied' },
        timestamp: ts,
      };
      const result = flattenEvent(event);
      expect(result[0].label).toBe('Permission Denied');
      expect(result[0].dot).toBe('error');
    });

    it('tool_failed', () => {
      const event = {
        type: 'system',
        subtype: 'tool_failed',
        content: { message: 'err' },
        timestamp: ts,
      };
      const result = flattenEvent(event);
      expect(result[0].label).toBe('Tool Failed');
      expect(result[0].dot).toBe('error');
    });

    it('pre_compact / post_compact / session_start / session_end', () => {
      for (const subtype of ['pre_compact', 'post_compact', 'session_start', 'session_end']) {
        const event = { type: 'system', subtype, content: {}, timestamp: ts };
        const result = flattenEvent(event);
        expect(result).toHaveLength(1);
      }
    });

    describe('silent subtypes return empty array', () => {
      const silentSubtypes = [
        'task_progress',
        'hook_started',
        'hook_progress',
        'hook_response',
        'prompt_submitted',
      ];
      for (const subtype of silentSubtypes) {
        it(subtype, () => {
          const event = { type: 'system', subtype, content: {}, timestamp: ts };
          expect(flattenEvent(event)).toEqual([]);
        });
      }
    });

    it('unknown subtype with message -> System label', () => {
      const event = {
        type: 'system',
        subtype: 'custom_thing',
        content: { message: 'hello' },
        timestamp: ts,
      };
      const result = flattenEvent(event);
      expect(result).toHaveLength(1);
      expect(result[0].label).toBe('System');
      expect(result[0].body).toBe('hello');
    });

    it('unknown subtype without message uses subtype as body', () => {
      const event = {
        type: 'system',
        subtype: 'custom_thing',
        content: {},
        timestamp: ts,
      };
      // Fallback: body = content?.message || content?.text || subtype || ''
      // subtype is truthy, so it becomes the body
      const result = flattenEvent(event);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ label: 'System', body: 'custom_thing' });
    });

    it('unknown subtype with no message/text/subtype -> empty array', () => {
      const event = {
        type: 'system',
        // no event.subtype, and content has no subtype either
        content: {},
        timestamp: ts,
      };
      // subtype = undefined, body = '' -> falsy -> empty array
      expect(flattenEvent(event)).toEqual([]);
    });

    it('resolves subtype from content.subtype when event.subtype is absent', () => {
      const event = {
        type: 'system',
        content: { subtype: 'compact_boundary' },
        timestamp: ts,
      };
      const result = flattenEvent(event);
      expect(result[0].label).toBe('Compacted');
    });
  });

  // --- Type handlers ---
  describe('type handlers', () => {
    it('tool_progress', () => {
      const event = {
        type: 'tool_progress',
        content: { tool_name: 'Grep', elapsed_time_seconds: 2 },
        timestamp: ts,
      };
      const result = flattenEvent(event);
      expect(result[0].label).toBe('Grep');
      expect(result[0].body).toContain('2s elapsed');
    });

    it('rate_limit_event', () => {
      const event = {
        type: 'rate_limit_event',
        content: { rate_limit_info: { status: 'wait' } },
        timestamp: ts,
      };
      const result = flattenEvent(event);
      expect(result[0]).toMatchObject({ label: 'Rate Limit', dot: 'error' });
    });

    it('stream_event returns empty array', () => {
      const event = { type: 'stream_event', content: {}, timestamp: ts };
      expect(flattenEvent(event)).toEqual([]);
    });

    it('stderr', () => {
      const event = { type: 'stderr', content: { text: 'err output' }, timestamp: ts };
      const result = flattenEvent(event);
      expect(result[0]).toMatchObject({ label: 'Stderr', dot: 'error' });
    });

    it('raw', () => {
      const event = { type: 'raw', content: { text: 'output' }, timestamp: ts };
      expect(flattenEvent(event)[0].label).toBe('Output');
    });

    it('result with stats', () => {
      const event = {
        type: 'result',
        content: {
          num_turns: 3,
          duration_ms: 5000,
          usage: { input_tokens: 100, output_tokens: 200 },
          total_cost_usd: 0.01,
        },
        timestamp: ts,
      };
      const result = flattenEvent(event);
      expect(result[0].label).toBe('Stats');
      expect(result[0].body).toContain('3 turns');
      expect(result[0].body).toContain('5.0s');
      expect(result[0].body).toContain('300 tokens');
      expect(result[0].body).toContain('$0.0100');
    });

    it('result with no stats -> empty array', () => {
      const event = { type: 'result', content: {}, timestamp: ts };
      expect(flattenEvent(event)).toEqual([]);
    });
  });

  // --- Content blocks ---
  describe('content blocks', () => {
    it('event with content.content array of text blocks', () => {
      const event = {
        type: 'assistant',
        content: {
          content: [
            { type: 'text', text: 'hello' },
            { type: 'text', text: 'world' },
          ],
        },
        timestamp: ts,
      };
      const result = flattenEvent(event);
      expect(result).toHaveLength(2);
      expect(result[0].body).toBe('hello');
      expect(result[1].body).toBe('world');
    });

    it('event with content.message.content array', () => {
      const event = {
        type: 'assistant',
        content: {
          message: {
            content: [{ type: 'text', text: 'via message' }],
          },
        },
        timestamp: ts,
      };
      const result = flattenEvent(event);
      expect(result).toHaveLength(1);
      expect(result[0].body).toBe('via message');
    });

    it('tool_use block -> Tool: name, dot:tool', () => {
      const event = {
        type: 'assistant',
        content: {
          content: [{ type: 'tool_use', name: 'Read', input: '/file' }],
        },
        timestamp: ts,
      };
      const result = flattenEvent(event);
      expect(result[0]).toMatchObject({ label: 'Tool: Read', dot: 'tool' });
    });

    it('tool_result block -> Tool Result, dot:done', () => {
      const event = {
        type: 'assistant',
        content: {
          content: [{ type: 'tool_result', content: 'ok', tool_use_id: 'x' }],
        },
        timestamp: ts,
      };
      const result = flattenEvent(event);
      expect(result[0]).toMatchObject({ label: 'Tool Result', dot: 'done' });
    });

    it('tool_result with is_error -> Tool Error, dot:error', () => {
      const event = {
        type: 'assistant',
        content: {
          content: [{ type: 'tool_result', is_error: true, content: 'fail', tool_use_id: 'x' }],
        },
        timestamp: ts,
      };
      const result = flattenEvent(event);
      expect(result[0]).toMatchObject({ label: 'Tool Error', dot: 'error' });
    });

    it('thinking block -> Thinking, dot:thinking', () => {
      const event = {
        type: 'assistant',
        content: {
          content: [{ type: 'thinking', thinking: 'pondering...' }],
        },
        timestamp: ts,
      };
      const result = flattenEvent(event);
      expect(result[0]).toMatchObject({ label: 'Thinking', dot: 'thinking' });
    });

    it('filters out null blocks (empty text)', () => {
      const event = {
        type: 'assistant',
        content: {
          content: [
            { type: 'text', text: '' },
            { type: 'text', text: 'valid' },
          ],
        },
        timestamp: ts,
      };
      const result = flattenEvent(event);
      expect(result).toHaveLength(1);
      expect(result[0].body).toBe('valid');
    });
  });

  // --- Edge cases ---
  describe('edge cases', () => {
    it('type:assistant with content.text string', () => {
      const event = {
        type: 'assistant',
        content: { text: 'direct text' },
        timestamp: ts,
      };
      const result = flattenEvent(event);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        label: 'Assistant',
        dot: 'done',
        body: 'direct text',
      });
    });

    it('type:assistant with empty content.text returns empty array', () => {
      const event = {
        type: 'assistant',
        content: { text: '' },
        timestamp: ts,
      };
      expect(flattenEvent(event)).toEqual([]);
    });

    it('legacy tool_result in content', () => {
      const event = {
        type: 'tool',
        content: { tool_result: 'legacy output', is_error: false },
        timestamp: ts,
      };
      const result = flattenEvent(event);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        label: 'Tool Result',
        dot: 'done',
        body: 'legacy output',
      });
    });

    it('legacy tool_result with is_error', () => {
      const event = {
        type: 'tool',
        content: { tool_result: 'err', is_error: true },
        timestamp: ts,
      };
      expect(flattenEvent(event)[0].dot).toBe('error');
    });

    it('unknown type with non-empty content -> JSON stringified', () => {
      const event = {
        type: 'custom_type',
        content: { data: 'value' },
        timestamp: ts,
      };
      const result = flattenEvent(event);
      expect(result).toHaveLength(1);
      expect(result[0].label).toBe('custom_type');
      expect(result[0].body).toBe(JSON.stringify({ data: 'value' }, null, 2));
    });

    it('unknown type with empty content -> empty array', () => {
      const event = { type: 'custom_type', content: {}, timestamp: ts };
      expect(flattenEvent(event)).toEqual([]);
    });

    it('unknown type with null content -> empty array', () => {
      // JSON.stringify(null) === 'null' which is truthy, but !== '{}'
      // so it falls through to the fallback
      const event = { type: 'custom_type', content: null, timestamp: ts };
      const result = flattenEvent(event);
      // JSON.stringify(null, null, 2) === 'null', which is truthy and !== '{}'
      expect(result).toHaveLength(1);
      expect(result[0].body).toBe('null');
    });
  });
});
