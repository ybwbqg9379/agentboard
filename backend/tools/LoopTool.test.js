import { describe, it, expect, vi, beforeEach } from 'vitest';
import { agentEvents, startAgent } from '../agentManager.js';
import { LoopTool } from './LoopTool.js';

let mockSessionIdCounter = 0;

vi.mock('../agentManager.js', async (importOriginal) => {
  const mod = await importOriginal();
  return {
    ...mod,
    startAgent: vi.fn(async () => `loop-session-${++mockSessionIdCounter}`),
  };
});

beforeEach(() => {
  mockSessionIdCounter = 0;
  startAgent.mockImplementation(async () => `loop-session-${++mockSessionIdCounter}`);
});

describe('LoopTool', () => {
  it('instantiates correctly with Name and Schema', () => {
    const tool = new LoopTool();
    expect(tool.name).toBe('LoopOperation');
    expect(tool.description).toContain('sequentially');
    expect(tool.inputSchema.properties).toHaveProperty('items');
  });

  it('returns early if no items provided', async () => {
    const tool = new LoopTool();
    const result = await tool.call({ instruction: 'do it', items: [] }, { userId: '123' });
    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain('No items provided');
  });

  it('processes items sequentially', async () => {
    const tool = new LoopTool();

    const promise = tool.call(
      { instruction: 'analyze', items: ['item-a', 'item-b'] },
      { userId: 'loop-user' },
    );

    // Each iteration awaits completion before starting the next
    setTimeout(() => {
      agentEvents.emit('event', {
        sessionId: 'loop-session-1',
        type: 'result',
        content: { result: 'Result A' },
      });
      agentEvents.emit('event', {
        sessionId: 'loop-session-1',
        type: 'done',
        content: { status: 'completed' },
      });
    }, 10);

    setTimeout(() => {
      agentEvents.emit('event', {
        sessionId: 'loop-session-2',
        type: 'done',
        content: { status: 'completed' },
      });
    }, 30);

    const result = await promise;
    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain('Loop Sequence Completed: 2 items');
    expect(result.content[0].text).toContain('Result A');
  });

  it('cleans up listener and timer when startAgent rejects', async () => {
    const tool = new LoopTool();
    const listenerCountBefore = agentEvents.listenerCount('event');

    startAgent.mockRejectedValue(new Error('launch failure'));

    const result = await tool.call({ instruction: 'will fail', items: ['x'] }, { userId: 'u1' });

    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain('[Failed to start: launch failure]');
    expect(agentEvents.listenerCount('event')).toBe(listenerCountBefore);
  });
});
