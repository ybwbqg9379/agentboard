import { describe, it, expect, vi, beforeEach } from 'vitest';
import { saveEntity, saveRelation, getUserMemoryGraph } from '../memoryStore.js';
import { RememberTool, RecallTool } from './RememberTool.js';

vi.mock('../memoryStore.js', () => ({
  saveEntity: vi.fn(),
  saveRelation: vi.fn(),
  getUserMemoryGraph: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(saveEntity).mockReset();
  vi.mocked(saveRelation).mockReset();
  vi.mocked(getUserMemoryGraph).mockReset();
  vi.mocked(saveEntity).mockResolvedValue(undefined);
  vi.mocked(saveRelation).mockResolvedValue(undefined);
  vi.mocked(getUserMemoryGraph).mockResolvedValue({
    entities: [{ name: 'a', type: 't', content: 'c' }],
    relations: [],
  });
});

describe('RememberTool', () => {
  it('rejects default userId with isError response', async () => {
    const tool = new RememberTool();
    const r = await tool.call({ entities: [], relations: [] }, { userId: 'default' });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/authenticated tenant/i);
    expect(saveEntity).not.toHaveBeenCalled();
  });

  it('persists entities and relations for a tenant', async () => {
    const tool = new RememberTool();
    const r = await tool.call(
      {
        entities: [{ name: 'n', type: 'type', content: 'body' }],
        relations: [{ source: 'a', target: 'b', relation: 'uses' }],
      },
      { userId: 'tenant-1' },
    );
    expect(r.isError).toBe(false);
    expect(saveEntity).toHaveBeenCalledWith('tenant-1', 'n', 'type', 'body');
    expect(saveRelation).toHaveBeenCalledWith('tenant-1', 'a', 'b', 'uses');
  });

  it('returns isError when saveEntity throws', async () => {
    vi.mocked(saveEntity).mockRejectedValueOnce(new Error('disk full'));
    const tool = new RememberTool();
    const r = await tool.call(
      { entities: [{ name: 'x', type: 'y', content: 'z' }] },
      { userId: 'u1' },
    );
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('disk full');
  });
});

describe('RecallTool', () => {
  it('returns isError when userId is missing', async () => {
    const tool = new RecallTool();
    const r = await tool.call({}, {});
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/UserId not available/i);
  });

  it('formats graph from getUserMemoryGraph', async () => {
    const tool = new RecallTool();
    const r = await tool.call({}, { userId: 'u2' });
    expect(r.isError).toBe(false);
    expect(getUserMemoryGraph).toHaveBeenCalledWith('u2');
    expect(r.content[0].text).toContain('Memory Retrieval');
    expect(r.content[0].text).toContain('Entities: 1');
    expect(r.content[0].text).toContain('"name": "a"');
  });
});
