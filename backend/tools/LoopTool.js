import { Tool } from './Tool.js';
import { startAgent, agentEvents } from '../agentManager.js';

export class LoopTool extends Tool {
  constructor() {
    super({
      name: 'LoopOperation',
      description:
        'Iterate over a list of items sequentially. Use this when you must process a list of items ONE BY ONE where the order matters or you want to avoid rate limits/concurrency issues.',
      inputSchema: {
        type: 'object',
        properties: {
          instruction: {
            type: 'string',
            description: 'The instruction or task to apply to each item.',
          },
          items: {
            type: 'array',
            items: { type: 'string' },
            description:
              'List of target items (e.g., URLs, file paths, IDs) to process individually.',
          },
        },
        required: ['instruction', 'items'],
      },
      isConcurrencySafe: true,
      isDangerous: false,
    });
  }

  async call(input, context) {
    const { instruction = '', items = [] } = input;
    const { userId } = context;

    if (items.length === 0) {
      return { content: [{ type: 'text', text: 'No items provided for loop.' }], isError: false };
    }

    const activeItems = items.slice(0, 10); // Hardcap for safety
    const outcomes = [];

    try {
      for (const item of activeItems) {
        const fullPrompt = `<task>\n${instruction}\n</task>\n<target_item>\n${item}\n</target_item>\n\nExecute this independently. Return ONLY the final output.`;

        let targetSessionId = null;
        let finalResult = 'No result returned.';
        const SUB_AGENT_TIMEOUT_MS = 10 * 60 * 1000;
        let pendingTimeout;
        let pendingHandler;

        // Register listener BEFORE startAgent to prevent missing fast-completing done events
        const completionPromise = new Promise((resolve) => {
          pendingTimeout = setTimeout(() => {
            agentEvents.off('event', pendingHandler);
            outcomes.push({ item, result: '[Timed out]' });
            resolve();
          }, SUB_AGENT_TIMEOUT_MS);

          pendingHandler = function onEvent(event) {
            if (!targetSessionId || event.sessionId !== targetSessionId) return;

            if (event.type === 'result') {
              finalResult = event.content?.result || event.content?.last_assistant_message || '';
            }

            if (event.type === 'done') {
              clearTimeout(pendingTimeout);
              agentEvents.off('event', pendingHandler);
              outcomes.push({ item, result: finalResult });
              resolve();
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
          outcomes.push({ item, result: `[Failed to start: ${err.message}]` });
          continue;
        }

        await completionPromise;
      }

      const formatted = outcomes
        .map((o, idx) => `--- Iteration ${idx + 1}: ${o.item} ---\n${o.result}\n`)
        .join('\n');

      return {
        content: [
          {
            type: 'text',
            text: `[Loop Sequence Completed: ${outcomes.length} items processed sequentially]\n\n${formatted}`,
          },
        ],
        isError: false,
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Loop orchestration failed: ${err.message}` }],
        isError: true,
      };
    }
  }
}
