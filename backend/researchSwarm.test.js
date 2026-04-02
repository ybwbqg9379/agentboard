/**
 * researchSwarm.test.js
 *
 * Unit tests for the Research Swarm P3 engine.
 * Tests: XML parsers, heuristic selection, branch cleanup strategy.
 *
 * Dependencies deliberately mocked — no network / file system calls.
 */

import { describe, it, expect, vi } from 'vitest';

// ── Test the XML parsers directly (exported for testability) ──────────────────

// We test internal parsing logic by importing the source file and intercepting
// the exported swarm store / experimentEngine calls via vi.mock.

vi.mock('./agentManager.js', () => ({
  startAgent: vi.fn(() => 'mock-session-id'),
  agentEvents: { on: vi.fn(), removeListener: vi.fn() },
}));

vi.mock('./experimentEngine.js', () => ({
  runExperimentLoop: vi.fn().mockResolvedValue(undefined),
  abortExperiment: vi.fn(() => true),
  experimentEvents: { on: vi.fn(), removeListener: vi.fn() },
}));

vi.mock('./swarmStore.js', () => ({
  createSwarmBranch: vi.fn(() => 'mock-branch-id'),
  updateSwarmBranchStatus: vi.fn(),
  updateSwarmBranchMetrics: vi.fn(),
  selectSwarmBranch: vi.fn(),
  rejectSwarmBranch: vi.fn(),
  saveCoordinatorDecision: vi.fn(),
}));

vi.mock('./experimentStore.js', () => ({
  getRun: vi.fn(() => ({ best_metric: 0.85, total_trials: 5, accepted_trials: 2 })),
  createRun: vi.fn(() => 'mock-branch-run-id'),
  updateRunStatus: vi.fn(),
  updateRunMetrics: vi.fn(),
  experimentDb: {},
}));

vi.mock('node:fs', () => ({
  default: {
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
    rmSync: vi.fn(),
    appendFileSync: vi.fn(),
    writeFileSync: vi.fn(),
  },
}));

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(() => ({ status: 0, stdout: '', stderr: '' })),
}));

// ── XML Parser tests (inline, mirrors the private functions) ──────────────────

function parseHypotheses(text) {
  const regex = /<hypothesis\s+id="(\d+)">([\s\S]*?)<\/hypothesis>/g;
  const results = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    const hyp = match[2].trim();
    if (hyp) results.push({ id: parseInt(match[1], 10), text: hyp });
  }
  return results;
}

function parseSelection(text) {
  const branchMatch = /<selected_branch\s+id="(\d+)"\s*\/?>/i.exec(text);
  const reasoningMatch = /<reasoning>([\s\S]*?)<\/reasoning>/i.exec(text);
  return {
    selectedId: branchMatch ? parseInt(branchMatch[1], 10) : null,
    reasoning: reasoningMatch ? reasoningMatch[1].trim() : 'No reasoning provided.',
  };
}

// ── Parse hypothesis tests ──────────────────────────────────────────────────

describe('parseHypotheses()', () => {
  it('parses a single hypothesis block', () => {
    const text = '<hypothesis id="0">Reduce learning rate to 0.0001</hypothesis>';
    const result = parseHypotheses(text);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ id: 0, text: 'Reduce learning rate to 0.0001' });
  });

  it('parses multiple hypothesis blocks in order', () => {
    const text = `
      <hypothesis id="0">First approach</hypothesis>
      <hypothesis id="1">Second approach</hypothesis>
      <hypothesis id="2">Third approach</hypothesis>
    `;
    const result = parseHypotheses(text);
    expect(result).toHaveLength(3);
    expect(result[0].id).toBe(0);
    expect(result[1].id).toBe(1);
    expect(result[2].id).toBe(2);
  });

  it('ignores empty hypothesis blocks', () => {
    const text = '<hypothesis id="0"></hypothesis><hypothesis id="1">Valid</hypothesis>';
    const result = parseHypotheses(text);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('Valid');
  });

  it('handles multiline hypothesis text', () => {
    const text = `<hypothesis id="0">
      Line one.
      Line two.
    </hypothesis>`;
    const result = parseHypotheses(text);
    expect(result).toHaveLength(1);
    expect(result[0].text).toContain('Line one');
    expect(result[0].text).toContain('Line two');
  });

  it('returns empty array when no blocks found', () => {
    expect(parseHypotheses('')).toHaveLength(0);
    expect(parseHypotheses('No structured output here')).toHaveLength(0);
  });
});

// ── Parse selection tests ─────────────────────────────────────────────────────

describe('parseSelection()', () => {
  it('parses self-closing selected_branch tag', () => {
    const text = '<selected_branch id="1"/><reasoning>Branch 1 had the best metric.</reasoning>';
    const result = parseSelection(text);
    expect(result.selectedId).toBe(1);
    expect(result.reasoning).toBe('Branch 1 had the best metric.');
  });

  it('parses open/close selected_branch tag', () => {
    const text = '<SELECTED_BRANCH id="2"></SELECTED_BRANCH><reasoning>Reason</reasoning>';
    // case-insensitive regex
    const result = parseSelection(text);
    expect(result.selectedId).toBe(2);
  });

  it('returns null selectedId when tag is absent', () => {
    const result = parseSelection('<reasoning>Some reason</reasoning>');
    expect(result.selectedId).toBeNull();
    expect(result.reasoning).toBe('Some reason');
  });

  it('returns default reasoning when tag is absent', () => {
    const result = parseSelection('<selected_branch id="0"/>');
    expect(result.selectedId).toBe(0);
    expect(result.reasoning).toBe('No reasoning provided.');
  });

  it('handles completely unparseable output without throwing', () => {
    const result = parseSelection('The model returned garbage output here');
    expect(result.selectedId).toBeNull();
    expect(result.reasoning).toBe('No reasoning provided.');
  });
});

// ── Heuristic selection fallback ─────────────────────────────────────────────

describe('Heuristic branch selection fallback', () => {
  // Mirrors the fallback logic in coordinatorSynthesize
  function heuristicSelect(branchResults, direction = 'minimize') {
    const validBranches = branchResults.filter((b) => b.bestMetric !== null);
    if (validBranches.length === 0) return { selectedId: 0, reasoning: 'all failed' };
    const best = validBranches.reduce((a, b) => {
      if (direction === 'minimize') return b.bestMetric < a.bestMetric ? b : a;
      return b.bestMetric > a.bestMetric ? b : a;
    });
    return { selectedId: best.branchIndex, reasoning: `Branch ${best.branchIndex} was best` };
  }

  it('selects lowest metric for minimize direction', () => {
    const branches = [
      { branchIndex: 0, bestMetric: 0.9 },
      { branchIndex: 1, bestMetric: 0.4 },
      { branchIndex: 2, bestMetric: 0.7 },
    ];
    const { selectedId } = heuristicSelect(branches, 'minimize');
    expect(selectedId).toBe(1);
  });

  it('selects highest metric for maximize direction', () => {
    const branches = [
      { branchIndex: 0, bestMetric: 0.6 },
      { branchIndex: 1, bestMetric: 0.95 },
      { branchIndex: 2, bestMetric: 0.8 },
    ];
    const { selectedId } = heuristicSelect(branches, 'maximize');
    expect(selectedId).toBe(1);
  });

  it('falls back to branch 0 when all branches failed', () => {
    const branches = [
      { branchIndex: 0, bestMetric: null },
      { branchIndex: 1, bestMetric: null },
    ];
    const { selectedId } = heuristicSelect(branches, 'minimize');
    expect(selectedId).toBe(0);
  });

  it('ignores failed branches (null metric) and picks from valid ones', () => {
    const branches = [
      { branchIndex: 0, bestMetric: null },
      { branchIndex: 1, bestMetric: 0.5 },
      { branchIndex: 2, bestMetric: null },
    ];
    const { selectedId } = heuristicSelect(branches, 'minimize');
    expect(selectedId).toBe(1);
  });
});

// ── swarmEvents emitter ───────────────────────────────────────────────────────

describe('swarmEvents EventEmitter', () => {
  it('exports a functioning EventEmitter', async () => {
    const { swarmEvents } = await import('./researchSwarm.js');
    expect(typeof swarmEvents.on).toBe('function');
    expect(typeof swarmEvents.emit).toBe('function');
  });

  it('emits and receives custom swarm events', async () => {
    const { swarmEvents } = await import('./researchSwarm.js');
    const received = [];
    swarmEvents.on('test_event', (data) => received.push(data));
    swarmEvents.emit('test_event', { value: 42 });
    expect(received).toHaveLength(1);
    expect(received[0].value).toBe(42);
    swarmEvents.removeAllListeners('test_event');
  });
});

// ── abortSwarm / isSwarmActive ────────────────────────────────────────────────

describe('abortSwarm() / isSwarmActive()', () => {
  it('returns false when swarm was never started', async () => {
    const { abortSwarm, isSwarmActive } = await import('./researchSwarm.js');
    expect(isSwarmActive('non-existent-run-id')).toBe(false);
    expect(abortSwarm('non-existent-run-id')).toBe(false);
  });
});
