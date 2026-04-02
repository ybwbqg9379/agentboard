import { Tool } from './Tool.js';
import { startAgent, agentEvents } from '../agentManager.js';

export class BatchTool extends Tool {
  constructor() {
    super({
      name: 'BatchOperation',
      description:
        'Run multiple completely independent tasks or evaluations concurrently via isolated sub-agents. This is drastically faster than looping sequentially, but each task MUST NOT depend on the others. Once all sub-agents complete, returns an array of aggregated outcomes.',
      inputSchema: {
        type: 'object',
        properties: {
          common_context: {
            type: 'string',
            description:
              'Shared context summary prepended to all tasks (e.g. system state, rules).',
          },
          tasks: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Array of detailed instruction strings. Each element spawns a separate worker agent.',
          },
        },
        required: ['tasks'],
      },
      isConcurrencySafe: true,
      isDangerous: false,
    });
  }

  async call(input, context) {
    const { common_context = '', tasks = [] } = input;
    const { userId } = context;

    if (tasks.length === 0) {
      return { content: [{ type: 'text', text: 'No tasks provided for batch.' }], isError: false };
    }

    // Safety cap to prevent fork-bombing LLM quotas (limit to 10 concurrent)
    const activeTasks = tasks.slice(0, 10);

    try {
      // Launch all agents
      const taskPromises = activeTasks.map(async (taskDesc) => {
        const fullPrompt = `<context>\n${common_context}\n</context>\n<task>\n${taskDesc}\n</task>\n\nExecute this independently. Return ONLY the final output.`;

        let targetSessionId = null;
        let finalResult = 'No result returned.';
        const SUB_AGENT_TIMEOUT_MS = 10 * 60 * 1000;
        let pendingTimeout;
        let pendingHandler;

        const completionPromise = new Promise((resolve) => {
          pendingTimeout = setTimeout(() => {
            agentEvents.off('event', pendingHandler);
            resolve({ task: taskDesc, result: '[Timed out]' });
          }, SUB_AGENT_TIMEOUT_MS);

          pendingHandler = function onEvent(event) {
            if (!targetSessionId || event.sessionId !== targetSessionId) return;

            if (event.type === 'result') {
              finalResult = event.content?.result || event.content?.last_assistant_message || '';
            }

            if (event.type === 'done') {
              clearTimeout(pendingTimeout);
              agentEvents.off('event', pendingHandler);
              const status = event.content?.status || 'completed';
              if (status === 'completed') {
                resolve({ task: taskDesc, result: finalResult });
              } else {
                resolve({ task: taskDesc, result: `[Failed: ${status}]` });
              }
            }
          };
          agentEvents.on('event', pendingHandler);
        });

        try {
          targetSessionId = await startAgent(fullPrompt, {
            userId,
            permissionMode: 'bypassPermissions',
            maxTurns: 20,
          });
        } catch (err) {
          clearTimeout(pendingTimeout);
          agentEvents.off('event', pendingHandler);
          return { task: taskDesc, result: `[Failed to start: ${err.message}]` };
        }

        return completionPromise;
      });

      const outcomes = await Promise.all(taskPromises);

      const formatted = outcomes
        .map((o, idx) => `--- Task ${idx + 1} Outcome ---\n${o.result}\n`)
        .join('\n');

      return {
        content: [
          {
            type: 'text',
            text: `[Batch Operation Completed: ${outcomes.length} tasks run concurrently]\n\n${formatted}`,
          },
        ],
        isError: false,
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Batch orchestration failed: ${err.message}` }],
        isError: true,
      };
    }
  }
}
