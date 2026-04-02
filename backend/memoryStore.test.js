/**
 * Unit tests for Supabase-based memory store.
 *
 * Mocks the Supabase client to avoid real network calls.
 * All store functions are async -- every call uses await.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Supabase mock
// ---------------------------------------------------------------------------

let mockFromHandler;

vi.mock('./supabaseClient.js', () => {
  const createChainable = (resolvedValue = { data: null, error: null }) => {
    const target = {};

    const proxy = new Proxy(target, {
      get(t, prop) {
        if (prop === 'then') {
          return (cb) => Promise.resolve(resolvedValue).then(cb);
        }
        if (prop === 'single' || prop === 'maybeSingle') {
          return t[prop] || (() => Promise.resolve(resolvedValue));
        }
        if (t[prop]) return t[prop];
        return () => proxy;
      },
      set(t, prop, value) {
        t[prop] = value;
        return true;
      },
    });

    const methods = [
      'select',
      'insert',
      'update',
      'delete',
      'upsert',
      'eq',
      'order',
      'limit',
      'range',
    ];
    for (const m of methods) {
      target[m] = vi.fn().mockReturnValue(proxy);
    }
    target.single = vi.fn().mockResolvedValue(resolvedValue);
    target.maybeSingle = vi.fn().mockResolvedValue(resolvedValue);

    return proxy;
  };

  return {
    default: {
      from: vi.fn((...args) => {
        if (mockFromHandler) return mockFromHandler(...args);
        return createChainable({ data: [], error: null });
      }),
      _createChainable: createChainable,
    },
  };
});

const supabase = (await import('./supabaseClient.js')).default;
const createChainable = supabase._createChainable;

const { saveEntity, saveRelation, getUserMemoryGraph, closeMemoryDb } =
  await import('./memoryStore.js');

beforeEach(() => {
  vi.clearAllMocks();
  mockFromHandler = undefined;
});

describe('memoryStore.js', () => {
  it('saveEntity upserts an entity and returns true', async () => {
    let capturedTable;
    let capturedRow;
    mockFromHandler = (table) => {
      capturedTable = table;
      const chain = createChainable({ data: null, error: null });
      chain.upsert = vi.fn((row, opts) => {
        capturedRow = row;
        expect(opts).toHaveProperty('onConflict', 'user_id,name,type');
        return chain;
      });
      return chain;
    };

    const success = await saveEntity('user1', 'ProjectX', 'Product', 'Productive Agent Framework');
    expect(success).toBe(true);
    expect(capturedTable).toBe('memory_entities');
    expect(capturedRow.user_id).toBe('user1');
    expect(capturedRow.name).toBe('ProjectX');
    expect(capturedRow.type).toBe('Product');
    expect(capturedRow.content).toBe('Productive Agent Framework');
  });

  it('saveRelation upserts a relation and returns true', async () => {
    let capturedRow;
    mockFromHandler = (table) => {
      const chain = createChainable({ data: null, error: null });
      if (table === 'memory_relations') {
        chain.upsert = vi.fn((row) => {
          capturedRow = row;
          return chain;
        });
      }
      return chain;
    };

    const success = await saveRelation('user1', 'Developer', 'ProjectX', 'builds');
    expect(success).toBe(true);
    expect(capturedRow.user_id).toBe('user1');
    expect(capturedRow.source_entity_name).toBe('Developer');
    expect(capturedRow.target_entity_name).toBe('ProjectX');
    expect(capturedRow.relation_type).toBe('builds');
  });

  it('getUserMemoryGraph retrieves entities and relations', async () => {
    const fakeEntities = [
      { name: 'ProjectX', type: 'Product', content: 'Productive Agent Framework' },
      { name: 'Developer', type: 'Person', content: 'A coder' },
    ];
    const fakeRelations = [
      { source_entity_name: 'Developer', target_entity_name: 'ProjectX', relation_type: 'builds' },
    ];

    mockFromHandler = (table) => {
      if (table === 'memory_entities') {
        return createChainable({ data: fakeEntities, error: null });
      }
      if (table === 'memory_relations') {
        return createChainable({ data: fakeRelations, error: null });
      }
      return createChainable({ data: [], error: null });
    };

    const graph = await getUserMemoryGraph('user1');
    expect(graph.entities.length).toBe(2);
    expect(graph.entities.some((r) => r.name === 'ProjectX')).toBe(true);
    expect(graph.relations.length).toBe(1);
    expect(graph.relations[0].source).toBe('Developer');
    expect(graph.relations[0].target).toBe('ProjectX');
    expect(graph.relations[0].relation).toBe('builds');
  });

  it('isolates memory between users (multi-tenant) via eq filter', async () => {
    let lastEqUser;
    mockFromHandler = (_table) => {
      const chain = createChainable({ data: [], error: null });
      chain.eq = vi.fn((col, val) => {
        if (col === 'user_id') lastEqUser = val;
        return chain;
      });
      return chain;
    };

    await getUserMemoryGraph('tenantA');
    expect(lastEqUser).toBe('tenantA');

    await getUserMemoryGraph('tenantB');
    expect(lastEqUser).toBe('tenantB');
  });

  it('exports closeMemoryDb as a no-op function', async () => {
    expect(typeof closeMemoryDb).toBe('function');
    await expect(closeMemoryDb()).resolves.not.toThrow();
  });
});
