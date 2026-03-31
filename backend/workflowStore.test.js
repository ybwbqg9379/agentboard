/**
 * Tests for workflow SQLite persistence layer.
 */

import { describe, it, expect, afterAll } from 'vitest';
import {
  createWorkflow,
  updateWorkflow,
  getWorkflow,
  listWorkflows,
  countWorkflows,
  deleteWorkflow,
  createWorkflowRun,
  updateWorkflowRun,
  completeWorkflowRun,
  getWorkflowRun,
  listWorkflowRuns,
  closeWorkflowDb,
} from './workflowStore.js';

afterAll(() => {
  closeWorkflowDb();
});

// ---------------------------------------------------------------------------
// Workflow CRUD
// ---------------------------------------------------------------------------

describe('Workflow CRUD', () => {
  const definition = {
    nodes: [
      { id: 'in', type: 'input', label: 'Start' },
      { id: 'out', type: 'output', label: 'End' },
    ],
    edges: [{ from: 'in', to: 'out' }],
  };

  let wfId;

  it('creates a workflow and returns a UUID', () => {
    wfId = createWorkflow('Test WF', 'A test workflow', definition);
    expect(wfId).toBeDefined();
    expect(typeof wfId).toBe('string');
    expect(wfId.length).toBe(36);
  });

  it('retrieves a workflow by ID with parsed definition', () => {
    const wf = getWorkflow(wfId);
    expect(wf).not.toBeNull();
    expect(wf.name).toBe('Test WF');
    expect(wf.description).toBe('A test workflow');
    expect(wf.definition).toEqual(definition);
  });

  it('returns null for non-existent workflow', () => {
    expect(getWorkflow('00000000-0000-0000-0000-000000000000')).toBeNull();
  });

  it('lists workflows with pagination', () => {
    const list = listWorkflows(10, 0);
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list[0].definition).toBeDefined();
  });

  it('counts workflows', () => {
    const count = countWorkflows();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it('updates a workflow', () => {
    const newDef = {
      ...definition,
      nodes: [...definition.nodes, { id: 'mid', type: 'agent', config: { prompt: 'hello' } }],
    };
    const updated = updateWorkflow(wfId, 'Updated WF', 'Updated desc', newDef);
    expect(updated).toBe(true);
    const wf = getWorkflow(wfId);
    expect(wf.name).toBe('Updated WF');
    expect(wf.definition.nodes).toHaveLength(3);
  });

  it('returns false when updating non-existent workflow', () => {
    const result = updateWorkflow('00000000-0000-0000-0000-000000000000', 'x', '', definition);
    expect(result).toBe(false);
  });

  it('deletes a workflow', () => {
    const id2 = createWorkflow('Delete Me', '', definition);
    expect(deleteWorkflow(id2)).toBe(true);
    expect(getWorkflow(id2)).toBeNull();
  });

  it('returns false when deleting non-existent workflow', () => {
    expect(deleteWorkflow('00000000-0000-0000-0000-000000000000')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Workflow Runs
// ---------------------------------------------------------------------------

describe('Workflow Runs', () => {
  let wfId;
  let runId;

  it('creates a run for a workflow', () => {
    wfId = createWorkflow('Run Test', '', {
      nodes: [
        { id: 'in', type: 'input' },
        { id: 'out', type: 'output' },
      ],
      edges: [{ from: 'in', to: 'out' }],
    });
    runId = createWorkflowRun(wfId, { input: 'hello' });
    expect(runId).toBeDefined();
    expect(typeof runId).toBe('string');
  });

  it('retrieves a run with parsed JSON fields', () => {
    const run = getWorkflowRun(runId);
    expect(run).not.toBeNull();
    expect(run.workflow_id).toBe(wfId);
    expect(run.status).toBe('pending');
    expect(run.context).toEqual({ input: 'hello' });
    expect(run.node_results).toEqual({});
  });

  it('updates a run', () => {
    updateWorkflowRun(runId, {
      status: 'running',
      context: { input: 'hello', step: 1 },
      nodeResults: { in: { done: true } },
    });
    const run = getWorkflowRun(runId);
    expect(run.status).toBe('running');
    expect(run.context.step).toBe(1);
    expect(run.node_results.in).toEqual({ done: true });
  });

  it('completes a run', () => {
    completeWorkflowRun(runId, {
      status: 'completed',
      nodeResults: { in: { done: true }, out: { done: true } },
    });
    const run = getWorkflowRun(runId);
    expect(run.status).toBe('completed');
    expect(run.completed_at).not.toBeNull();
  });

  it('lists runs for a workflow', () => {
    const runs = listWorkflowRuns(wfId, 10, 0);
    expect(Array.isArray(runs)).toBe(true);
    expect(runs.length).toBeGreaterThanOrEqual(1);
    expect(runs[0].context).toBeDefined();
  });

  it('returns null for non-existent run', () => {
    expect(getWorkflowRun('00000000-0000-0000-0000-000000000000')).toBeNull();
  });
});
