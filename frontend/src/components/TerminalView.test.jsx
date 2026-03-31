import { describe, it, expect, vi } from 'vitest';

vi.mock('./TerminalView.module.css', () => ({ default: {} }));

import { extractTerminalLines } from './TerminalView.jsx';

describe('extractTerminalLines', () => {
  it('returns empty array for empty events', () => {
    expect(extractTerminalLines([])).toEqual([]);
  });

  it('returns empty array when no Bash tools present', () => {
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

  it('extracts Bash tool_use commands from content.content blocks', () => {
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
    expect(lines[0]).toMatchObject({ type: 'command', text: 'ls -la' });
    expect(lines[0].key).toMatch(/^cmd-/);
  });

  it('extracts corresponding tool_result output matched by tool_use_id', () => {
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
    expect(lines[0]).toMatchObject({ type: 'command', text: 'echo hi' });
    expect(lines[1]).toMatchObject({ type: 'output', text: 'hi' });
  });

  it('ignores tool_results for non-Bash tools', () => {
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

  it('handles top-level tool_use events (type:tool_use)', () => {
    const events = [
      {
        type: 'tool_use',
        content: { name: 'Bash', id: 'tu1', input: { command: 'pwd' } },
      },
    ];
    const lines = extractTerminalLines(events);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ type: 'command', text: 'pwd' });
  });

  it('handles top-level tool_result events matched by tool_use_id', () => {
    const events = [
      {
        type: 'tool_use',
        content: { name: 'Bash', id: 'tu1', input: { command: 'pwd' } },
      },
      {
        type: 'tool_result',
        content: { tool_use_id: 'tu1', output: '/home/user' },
      },
    ];
    const lines = extractTerminalLines(events);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatchObject({ type: 'output', text: '/home/user' });
  });

  it('top-level tool_result for non-Bash tool is ignored', () => {
    const events = [
      {
        type: 'tool_use',
        content: { name: 'Read', id: 'tu1', input: { file_path: '/a' } },
      },
      {
        type: 'tool_result',
        content: { tool_use_id: 'tu1', output: 'data' },
      },
    ];
    expect(extractTerminalLines(events)).toEqual([]);
  });

  it('extracts stderr events as error type', () => {
    const events = [{ type: 'stderr', content: { text: 'permission denied' } }];
    const lines = extractTerminalLines(events);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ type: 'error', text: 'permission denied' });
    expect(lines[0].key).toMatch(/^err-/);
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

  it('handles input as string (block.input is a string directly)', () => {
    const events = [
      {
        type: 'assistant',
        content: {
          content: [{ type: 'tool_use', name: 'Bash', id: 'tu1', input: 'echo hello' }],
        },
      },
    ];
    const lines = extractTerminalLines(events);
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe('echo hello');
  });

  it('handles input as object with command key', () => {
    const events = [
      {
        type: 'assistant',
        content: {
          content: [
            { type: 'tool_use', name: 'Bash', id: 'tu1', input: { command: 'git status' } },
          ],
        },
      },
    ];
    const lines = extractTerminalLines(events);
    expect(lines[0].text).toBe('git status');
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

  it('mixed Bash and non-Bash tools (only Bash extracted)', () => {
    const events = [
      {
        type: 'assistant',
        content: {
          content: [
            { type: 'tool_use', name: 'Bash', id: 'tu1', input: { command: 'ls' } },
            { type: 'tool_result', tool_use_id: 'tu1', content: 'output' },
            { type: 'tool_use', name: 'Read', id: 'tu2', input: { file_path: '/x' } },
            { type: 'tool_result', tool_use_id: 'tu2', content: 'file data' },
            { type: 'tool_use', name: 'Bash', id: 'tu3', input: { command: 'pwd' } },
            { type: 'tool_result', tool_use_id: 'tu3', content: '/home' },
          ],
        },
      },
    ];
    const lines = extractTerminalLines(events);
    expect(lines).toHaveLength(4);
    expect(lines.every((l) => l.text !== 'file data')).toBe(true);
  });

  it('case sensitivity: both "Bash" and "bash" are accepted', () => {
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
    expect(lines[0].text).toBe('whoami');
  });

  it('top-level tool_use with input as string', () => {
    const events = [
      {
        type: 'tool_use',
        content: { name: 'Bash', id: 'tu1', input: 'echo direct' },
      },
    ];
    const lines = extractTerminalLines(events);
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toBe('echo direct');
  });

  it('top-level tool_result with content string fallback', () => {
    const events = [
      {
        type: 'tool_use',
        content: { name: 'Bash', id: 'tu1', input: { command: 'ls' } },
      },
      {
        type: 'tool_result',
        content: { tool_use_id: 'tu1', content: 'fallback output' },
      },
    ];
    const lines = extractTerminalLines(events);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatchObject({ type: 'output', text: 'fallback output' });
  });

  it('each line has a unique key', () => {
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

  it('skips tool_use with no command text', () => {
    const events = [
      {
        type: 'assistant',
        content: {
          content: [{ type: 'tool_use', name: 'Bash', id: 'tu1', input: {} }],
        },
      },
    ];
    const lines = extractTerminalLines(events);
    expect(lines).toEqual([]);
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
    expect(lines).toHaveLength(1); // only the command, no output
  });
});
