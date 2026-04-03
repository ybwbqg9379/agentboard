import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LSPTool } from './LSPTool.js';

// LSPTool caches ts-morph Project per userWorkspace; use a fresh directory per test.
let workspaceDir;
let teardown;

beforeEach(() => {
  workspaceDir = mkdtempSync(join(tmpdir(), 'lsptool-'));
  teardown = () => {
    try {
      rmSync(workspaceDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  };
});

afterEach(() => {
  teardown();
});

describe('LSPTool', () => {
  it('view_symbols outlines functions and classes', async () => {
    const filePath = join(workspaceDir, 'sample.js');
    writeFileSync(
      filePath,
      `function alpha() {}
export class Box {}
alpha();
`,
      'utf8',
    );
    const tool = new LSPTool();
    const r = await tool.execute(
      { action: 'view_symbols', filePath },
      { userWorkspace: workspaceDir },
    );
    expect(r.isError).toBe(false);
    expect(r.content[0].text).toContain('alpha');
    expect(r.content[0].text).toContain('Box');
  });

  it('find_references finds usages of a function', async () => {
    const filePath = join(workspaceDir, 'refs.js');
    writeFileSync(
      filePath,
      `function greet() { return 1; }
greet();
greet();
`,
      'utf8',
    );
    const tool = new LSPTool();
    const r = await tool.execute(
      { action: 'find_references', filePath, identifier: 'greet' },
      { userWorkspace: workspaceDir },
    );
    expect(r.isError).toBe(false);
    expect(r.content[0].text).toMatch(/Found \d+ reference/);
    expect(r.content[0].text).toContain('greet');
  });

  it('go_to_definition resolves local function', async () => {
    const filePath = join(workspaceDir, 'def.js');
    writeFileSync(
      filePath,
      `function inner() { return 42; }
export function outer() {
  return inner();
}
`,
      'utf8',
    );
    const tool = new LSPTool();
    const r = await tool.execute(
      { action: 'go_to_definition', filePath, identifier: 'inner' },
      { userWorkspace: workspaceDir },
    );
    expect(r.isError).toBe(false);
    expect(r.content[0].text).toMatch(/definition|Found|inner/i);
  });

  it('returns error when file is missing', async () => {
    const tool = new LSPTool();
    const r = await tool.execute(
      { action: 'view_symbols', filePath: join(workspaceDir, 'ghost.js') },
      { userWorkspace: workspaceDir },
    );
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('File not found');
  });

  it('returns error when identifier missing for find_references', async () => {
    const filePath = join(workspaceDir, 'noid.js');
    writeFileSync(filePath, 'const x = 1;\n', 'utf8');
    const tool = new LSPTool();
    const r = await tool.execute(
      { action: 'find_references', filePath },
      { userWorkspace: workspaceDir },
    );
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/identifier/i);
  });

  it('call delegates to execute', async () => {
    const filePath = join(workspaceDir, 'call.js');
    writeFileSync(filePath, 'function z() {}\n', 'utf8');
    const tool = new LSPTool();
    const r = await tool.call(
      { action: 'view_symbols', filePath },
      { userWorkspace: workspaceDir },
    );
    expect(r.isError).toBe(false);
    expect(r.content[0].text).toContain('z');
  });
});
