import { describe, it, expect } from 'vitest';
import {
  createEdge,
  edgeMatches,
  getDefaultEdgeCondition,
  updateEdge,
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
    expect(createEdge('agent', 'out', agentNode, [])).toEqual({ from: 'agent', to: 'out' });
    expect(getDefaultEdgeCondition(agentNode, [])).toBeUndefined();
  });

  it('matches edges by from/to pair', () => {
    expect(edgeMatches({ from: 'a', to: 'b' }, { from: 'a', to: 'b' })).toBe(true);
    expect(edgeMatches({ from: 'a', to: 'b' }, { from: 'a', to: 'c' })).toBe(false);
  });

  it('updates and clears edge condition', () => {
    const edges = [{ from: 'cond', to: 'out', condition: 'true' }];
    expect(updateEdge(edges, { from: 'cond', to: 'out' }, { condition: 'false' })).toEqual([
      { from: 'cond', to: 'out', condition: 'false' },
    ]);
    expect(updateEdge(edges, { from: 'cond', to: 'out' }, { condition: '' })).toEqual([
      { from: 'cond', to: 'out' },
    ]);
  });
});
