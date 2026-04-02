import { describe, it, expect, vi, beforeEach } from 'vitest';
import { agentEvents, startAgent } from '../agentManager.js';
import { TaskCreateTool } from './TaskCreateTool.js';

vi.mock('../agentManager.js', async (importOriginal) => {
  const mod = await importOriginal();
  return {
    ...mod,
    startAgent: vi.fn(async () => 'test-session-id'),
  };
});

beforeEach(() => {
  startAgent.mockImplementation(async () => 'test-session-id');
});

describe('TaskCreateTool', () => {
  it('instantiates correctly with native MCP interface', () => {
    const tool = new TaskCreateTool();
    expect(tool.name).toBe('TaskCreate');
    expect(tool.description).toContain('autonomously in the background');
    expect(tool.inputSchema.type).toBe('object');
  });

  it('rejects execution if prompt is missing', async () => {
    const tool = new TaskCreateTool();
    const input = { context_summary: 'no task' };
    const context = { userId: '123' };

    const promise = tool.call(input, context);

    setTimeout(() => {
      agentEvents.emit('event', {
        sessionId: 'test-session-id',
        type: 'done',
        content: { status: 'failed' },
      });
    }, 10);

    const result = await promise;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('[Sub-Agent Execution Failed]');
  });

  it('handles background execution successfully', async () => {
    const tool = new TaskCreateTool();

    const context = { userId: 'test_user' };
    const input = { task_description: 'do some complex analysis' };

    const promise = tool.call(input, context);

    setTimeout(() => {
      agentEvents.emit('event', {
        sessionId: 'test-session-id',
        type: 'result',
        content: { result: 'Analysis complete.' },
      });
      agentEvents.emit('event', {
        sessionId: 'test-session-id',
        type: 'done',
        content: { status: 'completed' },
      });
    }, 10);

    const result = await promise;
    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain('[Sub-Agent Task Completed Successfully]');
    expect(result.content[0].text).toContain('Analysis complete.');
  });

  it('cleans up listener and timer when startAgent rejects', async () => {
    const tool = new TaskCreateTool();
    const listenerCountBefore = agentEvents.listenerCount('event');

    startAgent.mockRejectedValue(new Error('launch failure'));

    const result = await tool.call({ task_description: 'will fail' }, { userId: 'u1' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('launch failure');
    expect(agentEvents.listenerCount('event')).toBe(listenerCountBefore);
  });
});
