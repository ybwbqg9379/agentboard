import { describe, it, expect, vi } from 'vitest';

vi.mock('./config.js', () => ({
  default: { dbPath: ':memory:' },
}));

const { saveEntity, saveRelation, getUserMemoryGraph } = await import('./memoryStore.js');

describe('memoryStore.js', () => {
  it('saveEntity creates an entity for a user', () => {
    const success = saveEntity('user1', 'ProjectX', 'Product', 'Productive Agent Framework');
    expect(success).toBe(true);
  });

  it('saveRelation creates a relation between entities for a user', () => {
    saveEntity('user1', 'Developer', 'Person', 'A coder');
    const success = saveRelation('user1', 'Developer', 'ProjectX', 'builds');
    expect(success).toBe(true);
  });

  it('getUserMemoryGraph retrieves entities correctly', () => {
    const graph = getUserMemoryGraph('user1');
    expect(graph.entities.length).toBeGreaterThan(0);
    expect(graph.entities.some((r) => r.name === 'ProjectX')).toBe(true);
    expect(graph.relations.some((r) => r.source === 'Developer')).toBe(true);
  });

  it('isolates memory between users (multi-tenant)', () => {
    saveEntity('tenantA', 'SecretKey', 'Key', '12345');

    // Tenant B searches
    const graphB = getUserMemoryGraph('tenantB');
    expect(graphB.entities.some((e) => e.name === 'SecretKey')).toBe(false);

    // Tenant A searches
    const graphA = getUserMemoryGraph('tenantA');
    expect(graphA.entities.some((e) => e.name === 'SecretKey')).toBe(true);
  });
});
