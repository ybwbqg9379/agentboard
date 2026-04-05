import { describe, it, expect, vi } from 'vitest';

vi.mock('./FileChangesPanel.module.css', () => ({ default: {} }));

import { extractFileChanges, workspaceFilesNotInToolList } from './FileChangesPanel.jsx';

describe('extractFileChanges', () => {
  it('returns empty array for empty events', () => {
    expect(extractFileChanges([])).toEqual([]);
  });

  it('counts Read operations per file', () => {
    const events = [
      {
        timestamp: '2026-03-31T12:00:00Z',
        content: {
          content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/src/a.js' } }],
        },
      },
      {
        timestamp: '2026-03-31T12:01:00Z',
        content: {
          content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/src/a.js' } }],
        },
      },
    ];
    const result = extractFileChanges(events);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ path: '/src/a.js', reads: 2, writes: 0, edits: 0 });
  });

  it('counts Write operations per file', () => {
    const events = [
      {
        timestamp: '2026-03-31T12:00:00Z',
        content: {
          content: [{ type: 'tool_use', name: 'Write', input: { file_path: '/src/b.js' } }],
        },
      },
    ];
    const result = extractFileChanges(events);
    expect(result[0]).toMatchObject({ path: '/src/b.js', reads: 0, writes: 1, edits: 0 });
  });

  it('counts Edit operations per file', () => {
    const events = [
      {
        timestamp: '2026-03-31T12:00:00Z',
        content: {
          content: [
            { type: 'tool_use', name: 'Edit', input: { file_path: '/src/c.js' } },
            { type: 'tool_use', name: 'Edit', input: { file_path: '/src/c.js' } },
          ],
        },
      },
    ];
    const result = extractFileChanges(events);
    expect(result[0]).toMatchObject({ path: '/src/c.js', reads: 0, writes: 0, edits: 2 });
  });

  it('aggregates multiple operations on same file', () => {
    const events = [
      {
        timestamp: '2026-03-31T12:00:00Z',
        content: {
          content: [
            { type: 'tool_use', name: 'Read', input: { file_path: '/src/x.js' } },
            { type: 'tool_use', name: 'Edit', input: { file_path: '/src/x.js' } },
          ],
        },
      },
      {
        timestamp: '2026-03-31T12:01:00Z',
        content: {
          content: [
            { type: 'tool_use', name: 'Write', input: { file_path: '/src/x.js' } },
            { type: 'tool_use', name: 'Read', input: { file_path: '/src/x.js' } },
          ],
        },
      },
    ];
    const result = extractFileChanges(events);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      path: '/src/x.js',
      reads: 2,
      writes: 1,
      edits: 1,
    });
  });

  it('sorts modified files (writes+edits > 0) before read-only, then by path', () => {
    const events = [
      {
        timestamp: '2026-03-31T12:00:00Z',
        content: {
          content: [
            { type: 'tool_use', name: 'Read', input: { file_path: '/z-readonly.js' } },
            { type: 'tool_use', name: 'Read', input: { file_path: '/a-readonly.js' } },
            { type: 'tool_use', name: 'Write', input: { file_path: '/m-modified.js' } },
            { type: 'tool_use', name: 'Edit', input: { file_path: '/b-modified.js' } },
          ],
        },
      },
    ];
    const result = extractFileChanges(events);
    expect(result).toHaveLength(4);
    // Modified files come first (writes+edits descending, then path ascending)
    expect(result[0].path).toBe('/b-modified.js');
    expect(result[1].path).toBe('/m-modified.js');
    // Read-only files sorted by path
    expect(result[2].path).toBe('/a-readonly.js');
    expect(result[3].path).toBe('/z-readonly.js');
  });

  it('handles file_path, path, and filePath input keys', () => {
    const events = [
      {
        timestamp: '2026-03-31T12:00:00Z',
        content: {
          content: [
            { type: 'tool_use', name: 'Read', input: { file_path: '/via-file_path.js' } },
            { type: 'tool_use', name: 'Read', input: { path: '/via-path.js' } },
            { type: 'tool_use', name: 'Read', input: { filePath: '/via-filePath.js' } },
          ],
        },
      },
    ];
    const result = extractFileChanges(events);
    const paths = result.map((f) => f.path);
    expect(paths).toContain('/via-file_path.js');
    expect(paths).toContain('/via-path.js');
    expect(paths).toContain('/via-filePath.js');
  });

  it('ignores non-file tool_use blocks (Bash, Grep, etc.)', () => {
    const events = [
      {
        timestamp: '2026-03-31T12:00:00Z',
        content: {
          content: [
            { type: 'tool_use', name: 'Bash', input: { command: 'ls' } },
            { type: 'tool_use', name: 'Grep', input: { pattern: 'foo' } },
          ],
        },
      },
    ];
    expect(extractFileChanges(events)).toEqual([]);
  });

  it('ignores tool_use blocks without any recognized path key', () => {
    const events = [
      {
        timestamp: '2026-03-31T12:00:00Z',
        content: {
          content: [{ type: 'tool_use', name: 'Read', input: { url: 'https://example.com' } }],
        },
      },
    ];
    expect(extractFileChanges(events)).toEqual([]);
  });

  it('ignores non-tool_use block types', () => {
    const events = [
      {
        timestamp: '2026-03-31T12:00:00Z',
        content: {
          content: [
            { type: 'text', text: 'hello' },
            { type: 'tool_result', content: 'ok' },
          ],
        },
      },
    ];
    expect(extractFileChanges(events)).toEqual([]);
  });

  it('multiple files with different operation counts', () => {
    const events = [
      {
        timestamp: '2026-03-31T12:00:00Z',
        content: {
          content: [
            { type: 'tool_use', name: 'Read', input: { file_path: '/src/a.js' } },
            { type: 'tool_use', name: 'Write', input: { file_path: '/src/b.js' } },
            { type: 'tool_use', name: 'Write', input: { file_path: '/src/b.js' } },
            { type: 'tool_use', name: 'Edit', input: { file_path: '/src/c.js' } },
            { type: 'tool_use', name: 'Edit', input: { file_path: '/src/c.js' } },
            { type: 'tool_use', name: 'Edit', input: { file_path: '/src/c.js' } },
          ],
        },
      },
    ];
    const result = extractFileChanges(events);
    expect(result).toHaveLength(3);
    // c.js has edits=3 (highest writes+edits), b.js has writes=2, a.js is read-only
    expect(result[0].path).toBe('/src/c.js');
    expect(result[0].edits).toBe(3);
    expect(result[1].path).toBe('/src/b.js');
    expect(result[1].writes).toBe(2);
    expect(result[2].path).toBe('/src/a.js');
    expect(result[2].reads).toBe(1);
  });

  it('firstSeen is set from event.timestamp', () => {
    const ts1 = '2026-03-31T12:00:00Z';
    const ts2 = '2026-03-31T12:05:00Z';
    const events = [
      {
        timestamp: ts1,
        content: {
          content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/a.js' } }],
        },
      },
      {
        timestamp: ts2,
        content: {
          content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/a.js' } }],
        },
      },
    ];
    const result = extractFileChanges(events);
    // firstSeen should be from the first event
    expect(result[0].firstSeen).toBe(ts1);
  });

  it('skips events without content.content array', () => {
    const events = [
      { timestamp: '2026-03-31T12:00:00Z', content: { text: 'hello' } },
      { timestamp: '2026-03-31T12:00:00Z', content: null },
      { timestamp: '2026-03-31T12:00:00Z' },
    ];
    expect(extractFileChanges(events)).toEqual([]);
  });

  it('handles content.message.content blocks', () => {
    // extractFileChanges checks: content?.content || content?.message?.content
    const events = [
      {
        timestamp: '2026-03-31T12:00:00Z',
        content: {
          message: {
            content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/via-message.js' } }],
          },
        },
      },
    ];
    const result = extractFileChanges(events);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('/via-message.js');
  });

  it('file_path takes precedence when multiple path keys present', () => {
    const events = [
      {
        timestamp: '2026-03-31T12:00:00Z',
        content: {
          content: [
            {
              type: 'tool_use',
              name: 'Read',
              input: { file_path: '/preferred.js', path: '/alt.js', filePath: '/alt2.js' },
            },
          ],
        },
      },
    ];
    const result = extractFileChanges(events);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('/preferred.js');
  });

  it('counts native MCP ReportTool fileName as a write', () => {
    const events = [
      {
        timestamp: '2026-03-31T12:00:00Z',
        content: {
          content: [
            {
              type: 'tool_use',
              name: 'mcp__agentboard_native__ReportTool',
              input: { fileName: 'out.pdf', title: 'T', content: 'x' },
            },
          ],
        },
      },
    ];
    const result = extractFileChanges(events);
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('out.pdf');
    expect(result[0].writes).toBe(1);
  });

  it('workspaceFilesNotInToolList excludes basenames already in tool paths', () => {
    const toolFiles = [{ path: '/ws/script.py' }];
    const ws = [{ name: 'script.py' }, { name: 'out.pdf' }];
    expect(workspaceFilesNotInToolList(toolFiles, ws)).toEqual([{ name: 'out.pdf' }]);
  });

  it('workspaceFilesNotInToolList dedupes Windows-style tool paths', () => {
    const toolFiles = [{ path: 'C:\\ws\\script.py' }];
    const ws = [{ name: 'script.py' }, { name: 'out.pdf' }];
    expect(workspaceFilesNotInToolList(toolFiles, ws)).toEqual([{ name: 'out.pdf' }]);
  });
});
