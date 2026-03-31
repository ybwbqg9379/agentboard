import { describe, it, expect, vi } from 'vitest';

vi.mock('./TerminalView.module.css', () => ({ default: {} }));

import { extractTerminalLines, getCommandDisplay } from './TerminalView.jsx';

// ---------------------------------------------------------------------------
// getCommandDisplay
// ---------------------------------------------------------------------------

describe('getCommandDisplay', () => {
  it('returns Bash command with $ prefix', () => {
    expect(getCommandDisplay('Bash', { command: 'ls' })).toEqual({ prefix: '$', text: 'ls' });
  });

  it('returns Bash with string input', () => {
    expect(getCommandDisplay('Bash', 'echo hi')).toEqual({ prefix: '$', text: 'echo hi' });
  });

  it('returns null for Bash with empty command', () => {
    expect(getCommandDisplay('Bash', {})).toBeNull();
  });

  it('handles lowercase "bash"', () => {
    expect(getCommandDisplay('bash', { command: 'pwd' })).toEqual({ prefix: '$', text: 'pwd' });
  });

  it('returns WebSearch query with ? prefix', () => {
    expect(getCommandDisplay('WebSearch', { query: 'test query' })).toEqual({
      prefix: '?',
      text: 'test query',
    });
  });

  it('returns null for WebSearch without query', () => {
    expect(getCommandDisplay('WebSearch', {})).toBeNull();
  });

  it('returns WebFetch URL with > prefix', () => {
    expect(getCommandDisplay('WebFetch', { url: 'https://example.com' })).toEqual({
      prefix: '>',
      text: 'https://example.com',
    });
  });

  it('returns null for WebFetch without url', () => {
    expect(getCommandDisplay('WebFetch', {})).toBeNull();
  });

  it('returns browser_navigate URL with > prefix', () => {
    expect(
      getCommandDisplay('mcp__browser__browser_navigate', { url: 'https://yahoo.com' }),
    ).toEqual({ prefix: '>', text: 'https://yahoo.com' });
  });

  it('returns browser_snapshot with > prefix', () => {
    expect(getCommandDisplay('mcp__browser__browser_snapshot', {})).toEqual({
      prefix: '>',
      text: 'browser snapshot',
    });
  });

  it('returns browser_click with element info', () => {
    expect(getCommandDisplay('mcp__browser__browser_click', { element: 'Submit' })).toEqual({
      prefix: '>',
      text: 'click Submit',
    });
  });

  it('returns browser_click with selector fallback', () => {
    expect(getCommandDisplay('mcp__browser__browser_click', { selector: '#btn' })).toEqual({
      prefix: '>',
      text: 'click #btn',
    });
  });

  it('returns browser_type with text', () => {
    expect(getCommandDisplay('mcp__browser__browser_type', { text: 'hello' })).toEqual({
      prefix: '>',
      text: 'type "hello"',
    });
  });

  it('returns null for unknown tools', () => {
    expect(getCommandDisplay('Read', { file_path: '/a' })).toBeNull();
    expect(getCommandDisplay('Write', { file_path: '/b' })).toBeNull();
    expect(getCommandDisplay('Grep', { pattern: 'x' })).toBeNull();
  });

  it('returns null for null/undefined name', () => {
    expect(getCommandDisplay(null, {})).toBeNull();
    expect(getCommandDisplay(undefined, {})).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// extractTerminalLines - Bash tools
// ---------------------------------------------------------------------------

describe('extractTerminalLines - Bash', () => {
  it('returns empty array for empty events', () => {
    expect(extractTerminalLines([])).toEqual([]);
  });

  it('returns empty array when no terminal tools present', () => {
    const events = [
      {
        type: 'assistant',
        content: {
          content: [{ type: 'tool_use', name: 'Read', id: 'tu1', input: { file_path: '/a.txt' } }],
        },
      },
    ];
    expect(extractTerminalLines(events)).toEqual([]);
  });

  it('extracts Bash commands from content blocks', () => {
    const events = [
      {
        type: 'assistant',
        content: {
          content: [{ type: 'tool_use', name: 'Bash', id: 'tu1', input: { command: 'ls -la' } }],
        },
      },
    ];
    const lines = extractTerminalLines(events);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ type: 'command', prefix: '$', text: 'ls -la' });
    expect(lines[0].key).toMatch(/^cmd-/);
  });

  it('extracts tool_result output matched by tool_use_id', () => {
    const events = [
      {
        type: 'assistant',
        content: {
          content: [
            { type: 'tool_use', name: 'Bash', id: 'tu1', input: { command: 'echo hi' } },
            { type: 'tool_result', tool_use_id: 'tu1', content: 'hi' },
          ],
        },
      },
    ];
    const lines = extractTerminalLines(events);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ type: 'command', prefix: '$', text: 'echo hi' });
    expect(lines[1]).toMatchObject({ type: 'output', text: 'hi' });
  });

  it('ignores tool_results for non-terminal tools', () => {
    const events = [
      {
        type: 'assistant',
        content: {
          content: [
            { type: 'tool_use', name: 'Read', id: 'tu1', input: { file_path: '/a' } },
            { type: 'tool_result', tool_use_id: 'tu1', content: 'file data' },
          ],
        },
      },
    ];
    expect(extractTerminalLines(events)).toEqual([]);
  });

  it('handles top-level tool_use events', () => {
    const events = [
      { type: 'tool_use', content: { name: 'Bash', id: 'tu1', input: { command: 'pwd' } } },
    ];
    const lines = extractTerminalLines(events);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ type: 'command', prefix: '$', text: 'pwd' });
  });

  it('handles top-level tool_result matched by ID', () => {
    const events = [
      { type: 'tool_use', content: { name: 'Bash', id: 'tu1', input: { command: 'pwd' } } },
      { type: 'tool_result', content: { tool_use_id: 'tu1', output: '/home/user' } },
    ];
    const lines = extractTerminalLines(events);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatchObject({ type: 'output', text: '/home/user' });
  });

  it('tool_result with is_error produces error type', () => {
    const events = [
      {
        type: 'assistant',
        content: {
          content: [
            { type: 'tool_use', name: 'Bash', id: 'tu1', input: { command: 'bad' } },
            { type: 'tool_result', tool_use_id: 'tu1', is_error: true, content: 'not found' },
          ],
        },
      },
    ];
    const lines = extractTerminalLines(events);
    expect(lines[1]).toMatchObject({ type: 'error', text: 'not found' });
  });

  it('extracts stderr events', () => {
    const events = [{ type: 'stderr', content: { text: 'permission denied' } }];
    const lines = extractTerminalLines(events);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ type: 'error', text: 'permission denied' });
    expect(lines[0].key).toMatch(/^err-/);
  });

  it('multiple Bash commands in sequence', () => {
    const events = [
      {
        type: 'assistant',
        content: {
          content: [
            { type: 'tool_use', name: 'Bash', id: 'tu1', input: { command: 'ls' } },
            { type: 'tool_result', tool_use_id: 'tu1', content: 'file.txt' },
            { type: 'tool_use', name: 'Bash', id: 'tu2', input: { command: 'cat file.txt' } },
            { type: 'tool_result', tool_use_id: 'tu2', content: 'contents' },
          ],
        },
      },
    ];
    const lines = extractTerminalLines(events);
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatchObject({ type: 'command', text: 'ls' });
    expect(lines[1]).toMatchObject({ type: 'output', text: 'file.txt' });
    expect(lines[2]).toMatchObject({ type: 'command', text: 'cat file.txt' });
    expect(lines[3]).toMatchObject({ type: 'output', text: 'contents' });
  });

  it('handles "bash" (lowercase)', () => {
    const events = [
      {
        type: 'assistant',
        content: {
          content: [{ type: 'tool_use', name: 'bash', id: 'tu1', input: { command: 'whoami' } }],
        },
      },
    ];
    const lines = extractTerminalLines(events);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ prefix: '$', text: 'whoami' });
  });

  it('skips Bash with empty command', () => {
    const events = [
      {
        type: 'assistant',
        content: {
          content: [{ type: 'tool_use', name: 'Bash', id: 'tu1', input: {} }],
        },
      },
    ];
    expect(extractTerminalLines(events)).toEqual([]);
  });

  it('skips tool_result with empty output', () => {
    const events = [
      {
        type: 'assistant',
        content: {
          content: [
            { type: 'tool_use', name: 'Bash', id: 'tu1', input: { command: 'true' } },
            { type: 'tool_result', tool_use_id: 'tu1', content: '' },
          ],
        },
      },
    ];
    const lines = extractTerminalLines(events);
    expect(lines).toHaveLength(1); // only the command
  });

  it('unique keys across all lines', () => {
    const events = [
      {
        type: 'assistant',
        content: {
          content: [
            { type: 'tool_use', name: 'Bash', id: 'tu1', input: { command: 'a' } },
            { type: 'tool_use', name: 'Bash', id: 'tu2', input: { command: 'b' } },
          ],
        },
      },
      { type: 'stderr', content: { text: 'err' } },
    ];
    const lines = extractTerminalLines(events);
    const keys = lines.map((l) => l.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

// ---------------------------------------------------------------------------
// extractTerminalLines - WebSearch / WebFetch / Browser MCP
// ---------------------------------------------------------------------------

describe('extractTerminalLines - web tools', () => {
  it('extracts WebSearch queries', () => {
    const events = [
      {
        type: 'assistant',
        content: {
          content: [
            { type: 'tool_use', name: 'WebSearch', id: 'ws1', input: { query: 'S&P 500 Q1' } },
          ],
        },
      },
    ];
    const lines = extractTerminalLines(events);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ type: 'command', prefix: '?', text: 'S&P 500 Q1' });
  });

  it('extracts WebFetch URLs', () => {
    const events = [
      {
        type: 'assistant',
        content: {
          content: [
            {
              type: 'tool_use',
              name: 'WebFetch',
              id: 'wf1',
              input: { url: 'https://example.com' },
            },
          ],
        },
      },
    ];
    const lines = extractTerminalLines(events);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ type: 'command', prefix: '>', text: 'https://example.com' });
  });

  it('extracts browser_navigate URLs', () => {
    const events = [
      {
        type: 'assistant',
        content: {
          content: [
            {
              type: 'tool_use',
              name: 'mcp__browser__browser_navigate',
              id: 'bn1',
              input: { url: 'https://yahoo.com' },
            },
          ],
        },
      },
    ];
    const lines = extractTerminalLines(events);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ type: 'command', prefix: '>', text: 'https://yahoo.com' });
  });

  it('extracts browser_snapshot', () => {
    const events = [
      {
        type: 'assistant',
        content: {
          content: [
            { type: 'tool_use', name: 'mcp__browser__browser_snapshot', id: 'bs1', input: {} },
          ],
        },
      },
    ];
    const lines = extractTerminalLines(events);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ type: 'command', prefix: '>', text: 'browser snapshot' });
  });

  it('extracts browser_click with element', () => {
    const events = [
      {
        type: 'assistant',
        content: {
          content: [
            {
              type: 'tool_use',
              name: 'mcp__browser__browser_click',
              id: 'bc1',
              input: { element: 'Submit' },
            },
          ],
        },
      },
    ];
    const lines = extractTerminalLines(events);
    expect(lines[0]).toMatchObject({ prefix: '>', text: 'click Submit' });
  });

  it('extracts browser_type', () => {
    const events = [
      {
        type: 'assistant',
        content: {
          content: [
            {
              type: 'tool_use',
              name: 'mcp__browser__browser_type',
              id: 'bt1',
              input: { text: 'hello' },
            },
          ],
        },
      },
    ];
    const lines = extractTerminalLines(events);
    expect(lines[0]).toMatchObject({ prefix: '>', text: 'type "hello"' });
  });

  it('does NOT show tool_result output for non-Bash tools', () => {
    const events = [
      {
        type: 'assistant',
        content: {
          content: [
            {
              type: 'tool_use',
              name: 'WebSearch',
              id: 'ws1',
              input: { query: 'test' },
            },
            {
              type: 'tool_result',
              tool_use_id: 'ws1',
              content: 'Search results...',
            },
          ],
        },
      },
    ];
    const lines = extractTerminalLines(events);
    // Only the command line, no output
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ type: 'command', prefix: '?' });
  });

  it('mixed Bash, WebSearch, and browser tools', () => {
    const events = [
      {
        type: 'assistant',
        content: {
          content: [
            { type: 'tool_use', name: 'Bash', id: 'tu1', input: { command: 'ls' } },
            { type: 'tool_result', tool_use_id: 'tu1', content: 'file.txt' },
            { type: 'tool_use', name: 'WebSearch', id: 'ws1', input: { query: 'stock data' } },
            { type: 'tool_result', tool_use_id: 'ws1', content: 'results' },
            {
              type: 'tool_use',
              name: 'mcp__browser__browser_navigate',
              id: 'bn1',
              input: { url: 'https://yahoo.com' },
            },
            { type: 'tool_use', name: 'Read', id: 'rd1', input: { file_path: '/a' } },
            { type: 'tool_result', tool_use_id: 'rd1', content: 'ignored' },
          ],
        },
      },
    ];
    const lines = extractTerminalLines(events);
    // Bash cmd + output + WebSearch cmd + browser_navigate cmd = 4 lines
    // Read tool is ignored, WebSearch tool_result is ignored
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatchObject({ prefix: '$', text: 'ls' });
    expect(lines[1]).toMatchObject({ type: 'output', text: 'file.txt' });
    expect(lines[2]).toMatchObject({ prefix: '?', text: 'stock data' });
    expect(lines[3]).toMatchObject({ prefix: '>', text: 'https://yahoo.com' });
  });

  it('top-level WebSearch tool_use', () => {
    const events = [
      { type: 'tool_use', content: { name: 'WebSearch', id: 'ws1', input: { query: 'q' } } },
    ];
    const lines = extractTerminalLines(events);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ prefix: '?', text: 'q' });
  });
});
