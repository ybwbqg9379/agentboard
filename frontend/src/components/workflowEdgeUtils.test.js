import { describe, it, expect } from 'vitest';
import {
  createEdge,
  edgeMatches,
  getDefaultEdgeCondition,
  updateEdge,
  ensureEdgeIds,
  syncEdgeIdCounter,
} from './workflowEdgeUtils.js';

describe('workflowEdgeUtils', () => {
  const conditionNode = { id: 'cond', type: 'condition' };
  const agentNode = { id: 'agent', type: 'agent' };

  it('defaults the first condition edge to true and the second to false', () => {
    const firstEdge = createEdge('cond', 'a', conditionNode, []);
    const secondEdge = createEdge('cond', 'b', conditionNode, [firstEdge]);

    expect(firstEdge.condition).toBe('true');
    expect(secondEdge.condition).toBe('false');
  });

  it('does not auto-tag edges from non-condition nodes', () => {
    const edge = createEdge('agent', 'out', agentNode, []);
    expect(edge.from).toBe('agent');
    expect(edge.to).toBe('out');
    expect(edge.condition).toBeUndefined();
    expect(edge.id).toBeDefined(); // edges now have unique ids
    expect(getDefaultEdgeCondition(agentNode, [])).toBeUndefined();
  });

  it('matches edges by id when available', () => {
    expect(edgeMatches({ id: 'e1', from: 'a', to: 'b' }, { id: 'e1', from: 'x', to: 'y' })).toBe(
      true,
    );
    expect(edgeMatches({ id: 'e1', from: 'a', to: 'b' }, { id: 'e2', from: 'a', to: 'b' })).toBe(
      false,
    );
  });

  it('falls back to from/to matching for legacy edges without id', () => {
    expect(edgeMatches({ from: 'a', to: 'b' }, { from: 'a', to: 'b' })).toBe(true);
    expect(edgeMatches({ from: 'a', to: 'b' }, { from: 'a', to: 'c' })).toBe(false);
  });

  it('updates and clears edge condition', () => {
    const edges = [{ id: 'e1', from: 'cond', to: 'out', condition: 'true' }];
    expect(
      updateEdge(edges, { id: 'e1', from: 'cond', to: 'out' }, { condition: 'false' }),
    ).toEqual([{ id: 'e1', from: 'cond', to: 'out', condition: 'false' }]);
    expect(updateEdge(edges, { id: 'e1', from: 'cond', to: 'out' }, { condition: '' })).toEqual([
      { id: 'e1', from: 'cond', to: 'out' },
    ]);
  });

  it('ensureEdgeIds assigns ids to edges that lack them', () => {
    const edges = [
      { from: 'a', to: 'b' },
      { id: 'edge_5', from: 'c', to: 'd' },
    ];
    const result = ensureEdgeIds(edges);
    expect(result[0].id).toBeDefined();
    expect(result[1].id).toBe('edge_5');
  });

  it('syncEdgeIdCounter prevents id collisions with existing edges', () => {
    syncEdgeIdCounter([{ id: 'edge_10' }, { id: 'edge_3' }]);
    const edge = createEdge('a', 'b', agentNode, []);
    const num = parseInt(edge.id.replace('edge_', ''), 10);
    expect(num).toBeGreaterThan(10);
  });
});
