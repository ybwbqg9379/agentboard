/**
 * Tests for workflow engine: validation, topological sort, condition evaluation.
 */

import { describe, it, expect } from 'vitest';
import { validateWorkflow, topologicalSort, evaluateCondition } from './workflowEngine.js';

// ---------------------------------------------------------------------------
// validateWorkflow
// ---------------------------------------------------------------------------

describe('validateWorkflow', () => {
  const minValid = {
    nodes: [
      { id: 'in', type: 'input', label: 'Start', config: {} },
      { id: 'out', type: 'output', label: 'End', config: {} },
    ],
    edges: [{ from: 'in', to: 'out' }],
  };

  it('accepts a minimal valid workflow', () => {
    const result = validateWorkflow(minValid);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects empty nodes array', () => {
    const result = validateWorkflow({ nodes: [], edges: [] });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Workflow must have at least one node');
  });

  it('rejects null definition', () => {
    const result = validateWorkflow(null);
    expect(result.valid).toBe(false);
  });

  it('rejects missing input node', () => {
    const result = validateWorkflow({
      nodes: [{ id: 'out', type: 'output', label: 'End' }],
      edges: [],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('input'))).toBe(true);
  });

  it('rejects missing output node', () => {
    const result = validateWorkflow({
      nodes: [{ id: 'in', type: 'input', label: 'Start' }],
      edges: [],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('output'))).toBe(true);
  });

  it('rejects unknown node type', () => {
    const result = validateWorkflow({
      nodes: [
        { id: 'in', type: 'input' },
        { id: 'x', type: 'magic' },
        { id: 'out', type: 'output' },
      ],
      edges: [],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Unknown node type'))).toBe(true);
  });

  it('rejects agent node without prompt', () => {
    const result = validateWorkflow({
      nodes: [
        { id: 'in', type: 'input' },
        { id: 'a', type: 'agent', config: {} },
        { id: 'out', type: 'output' },
      ],
      edges: [
        { from: 'in', to: 'a' },
        { from: 'a', to: 'out' },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('missing prompt'))).toBe(true);
  });

  it('rejects edges referencing unknown nodes', () => {
    const result = validateWorkflow({
      nodes: [
        { id: 'in', type: 'input' },
        { id: 'out', type: 'output' },
      ],
      edges: [{ from: 'in', to: 'ghost' }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('ghost'))).toBe(true);
  });

  it('detects cycles', () => {
    const result = validateWorkflow({
      nodes: [
        { id: 'in', type: 'input' },
        { id: 'a', type: 'agent', config: { prompt: 'do stuff' } },
        { id: 'b', type: 'agent', config: { prompt: 'more stuff' } },
        { id: 'out', type: 'output' },
      ],
      edges: [
        { from: 'in', to: 'a' },
        { from: 'a', to: 'b' },
        { from: 'b', to: 'a' }, // cycle
        { from: 'b', to: 'out' },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('cycle'))).toBe(true);
  });

  it('accepts a complex valid DAG', () => {
    const result = validateWorkflow({
      nodes: [
        { id: 'in', type: 'input' },
        { id: 'a1', type: 'agent', config: { prompt: 'task 1' } },
        { id: 'a2', type: 'agent', config: { prompt: 'task 2' } },
        { id: 'cond', type: 'condition', config: { expression: 'status == "ok"' } },
        { id: 'tx', type: 'transform', config: { mapping: { x: '{{y}}' } } },
        { id: 'out', type: 'output' },
      ],
      edges: [
        { from: 'in', to: 'a1' },
        { from: 'in', to: 'a2' },
        { from: 'a1', to: 'cond' },
        { from: 'a2', to: 'tx' },
        { from: 'cond', to: 'out' },
        { from: 'tx', to: 'out' },
      ],
    });
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// topologicalSort
// ---------------------------------------------------------------------------

describe('topologicalSort', () => {
  it('returns correct order for a linear chain', () => {
    const nodes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const edges = [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
    ];
    const sorted = topologicalSort(nodes, edges);
    expect(sorted).toEqual(['a', 'b', 'c']);
  });

  it('returns correct order for a diamond DAG', () => {
    const nodes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
    const edges = [
      { from: 'a', to: 'b' },
      { from: 'a', to: 'c' },
      { from: 'b', to: 'd' },
      { from: 'c', to: 'd' },
    ];
    const sorted = topologicalSort(nodes, edges);
    expect(sorted).not.toBeNull();
    expect(sorted[0]).toBe('a');
    expect(sorted[sorted.length - 1]).toBe('d');
  });

  it('returns null for a cycle', () => {
    const nodes = [{ id: 'a' }, { id: 'b' }];
    const edges = [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'a' },
    ];
    expect(topologicalSort(nodes, edges)).toBeNull();
  });

  it('handles disconnected nodes', () => {
    const nodes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const edges = [{ from: 'a', to: 'b' }];
    const sorted = topologicalSort(nodes, edges);
    expect(sorted).toHaveLength(3);
    expect(sorted.indexOf('a')).toBeLessThan(sorted.indexOf('b'));
  });

  it('handles single node', () => {
    const sorted = topologicalSort([{ id: 'x' }], []);
    expect(sorted).toEqual(['x']);
  });
});

// ---------------------------------------------------------------------------
// evaluateCondition
// ---------------------------------------------------------------------------

describe('evaluateCondition', () => {
  it('returns true for empty/null expression', () => {
    expect(evaluateCondition(null, {})).toBe(true);
    expect(evaluateCondition('', {})).toBe(true);
  });

  it('evaluates == correctly', () => {
    expect(evaluateCondition('status == "ok"', { status: 'ok' })).toBe(true);
    expect(evaluateCondition('status == "ok"', { status: 'fail' })).toBe(false);
  });

  it('evaluates != correctly', () => {
    expect(evaluateCondition('status != "ok"', { status: 'fail' })).toBe(true);
    expect(evaluateCondition('status != "ok"', { status: 'ok' })).toBe(false);
  });

  it('evaluates > correctly', () => {
    expect(evaluateCondition('count > 5', { count: 10 })).toBe(true);
    expect(evaluateCondition('count > 5', { count: 3 })).toBe(false);
  });

  it('evaluates < correctly', () => {
    expect(evaluateCondition('count < 5', { count: 3 })).toBe(true);
    expect(evaluateCondition('count < 5', { count: 10 })).toBe(false);
  });

  it('evaluates contains correctly', () => {
    expect(evaluateCondition('msg contains "hello"', { msg: 'say hello world' })).toBe(true);
    expect(evaluateCondition('msg contains "hello"', { msg: 'goodbye' })).toBe(false);
  });

  it('handles nested key paths', () => {
    expect(evaluateCondition('a.b.c == "deep"', { a: { b: { c: 'deep' } } })).toBe(true);
    expect(evaluateCondition('a.b.c == "deep"', { a: { b: { c: 'shallow' } } })).toBe(false);
  });

  it('returns falsy for non-matching simple expression', () => {
    expect(evaluateCondition('missing', {})).toBe(false);
  });

  it('returns truthy for truthy simple expression', () => {
    expect(evaluateCondition('exists', { exists: true })).toBe(true);
    expect(evaluateCondition('exists', { exists: 'yes' })).toBe(true);
  });
});
