import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeInSandbox } from './dockerSandbox.js';
import { REPLTool } from './REPLTool.js';

vi.mock('./dockerSandbox.js', () => ({
  executeInSandbox: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(executeInSandbox).mockReset();
});

describe('REPLTool', () => {
  it('exposes name and schema for node and python', () => {
    const tool = new REPLTool();
    expect(tool.name).toBe('REPLTool');
    expect(tool.inputSchema.required).toEqual(['code', 'language']);
    expect(tool.inputSchema.properties.language.enum).toEqual(['node', 'python']);
  });

  it('throws when userWorkspace is missing', async () => {
    const tool = new REPLTool();
    await expect(tool.call({ code: '1', language: 'node' }, { userId: 'u1' })).rejects.toThrow(
      'userWorkspace',
    );
  });

  it('returns formatted stdout and isError false on exit 0', async () => {
    vi.mocked(executeInSandbox).mockResolvedValue({
      stdout: 'ok\n',
      stderr: '',
      exitCode: 0,
    });
    const tool = new REPLTool();
    const r = await tool.call({ code: '1+1', language: 'node' }, { userWorkspace: '/ws' });
    expect(r.isError).toBe(false);
    expect(r.content[0].text).toContain('Exit Code: 0');
    expect(r.content[0].text).toContain('STDOUT:');
    expect(r.content[0].text).toContain('ok');
    expect(executeInSandbox).toHaveBeenCalledWith('/ws', '1+1', 'node');
  });

  it('sets isError true when exitCode is non-zero', async () => {
    vi.mocked(executeInSandbox).mockResolvedValue({
      stdout: '',
      stderr: 'err',
      exitCode: 2,
    });
    const tool = new REPLTool();
    const r = await tool.call({ code: 'x', language: 'python' }, { userWorkspace: '/ws' });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('Exit Code: 2');
    expect(r.content[0].text).toContain('STDERR:');
    expect(executeInSandbox).toHaveBeenCalledWith('/ws', 'x', 'python');
  });

  it('returns sandbox failure content when executeInSandbox rejects', async () => {
    vi.mocked(executeInSandbox).mockRejectedValue(new Error('no docker'));
    const tool = new REPLTool();
    const r = await tool.call({ code: '1', language: 'node' }, { userWorkspace: '/ws' });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('Sandbox Failure');
    expect(r.content[0].text).toContain('no docker');
  });
});
