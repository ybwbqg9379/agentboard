import { describe, it, expect, vi } from 'vitest';
import { agentEvents } from '../agentManager.js';
import { BatchTool } from './BatchTool.js';

let mockSessionIdCounter = 0;

vi.mock('../agentManager.js', async (importOriginal) => {
  const mod = await importOriginal();
  return {
    ...mod,
    startAgent: vi.fn(() => `test-session-${++mockSessionIdCounter}`),
  };
});

describe('BatchTool', () => {
  it('instantiates correctly with Name and Schema', () => {
    const tool = new BatchTool();
    expect(tool.name).toBe('BatchOperation');
    expect(tool.description).toContain('concurrently via isolated sub-agents');
    expect(tool.inputSchema.properties).toHaveProperty('tasks');
  });

  it('bypasses logic if no tasks provided', async () => {
    const tool = new BatchTool();
    const result = await tool.call({ tasks: [] }, { userId: '123' });

    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain('No tasks provided');
  });

  it('processes a batch of tasks successfully', async () => {
    const tool = new BatchTool();

    mockSessionIdCounter = 0;

    const promise = tool.call(
      {
        common_context: 'System rules',
        tasks: ['task 1', 'task 2'],
      },
      {
        userId: 'batch-user',
      },
    );

    setTimeout(() => {
      // Agent 1
      agentEvents.emit('event', {
        sessionId: 'test-session-1',
        type: 'result',
        content: { result: 'Output 1' },
      });
      agentEvents.emit('event', {
        sessionId: 'test-session-1',
        type: 'done',
        content: { status: 'completed' },
      });

      // Agent 2
      agentEvents.emit('event', {
        sessionId: 'test-session-2',
        type: 'done',
        content: { status: 'failed' },
      });
    }, 10);

    const result = await promise;
    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain(
      '[Batch Operation Completed: 2 tasks run concurrently]',
    );
    expect(result.content[0].text).toContain('--- Task 1 Outcome ---');
    expect(result.content[0].text).toContain('Output 1');
    expect(result.content[0].text).toContain('--- Task 2 Outcome ---');
    expect(result.content[0].text).toContain('[Failed: failed]');
  });
});
