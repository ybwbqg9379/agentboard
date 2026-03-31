import { Tool } from './Tool.js';
import { startAgent, agentEvents } from '../agentManager.js';

export class TaskCreateTool extends Tool {
  constructor() {
    super({
      name: 'TaskCreate',
      description:
        'Orchestrate a sub-agent to complete a complex task autonomously in the background. Use this when a problem has many sub-steps, requires extensive reading, or would pollute your current context window. The sub-agent runs in a completely isolated session and returns a concise JSON outcome report.',
      inputSchema: {
        type: 'object',
        properties: {
          task_description: {
            type: 'string',
            description:
              'Clear, exhaustive instructions for the sub-agent. Include all known constraints and acceptance criteria.',
          },
          context_summary: {
            type: 'string',
            description:
              'A summary of the current state or files to look at, giving the sub-agent a starting point.',
          },
        },
        required: ['task_description'],
      },
      isConcurrencySafe: true,
      isDangerous: false,
    });
  }

  async call(input, context) {
    const { task_description, context_summary } = input;
    const { userId } = context;

    const fullPrompt = `<context>\n${context_summary || 'No context.'}\n</context>\n<task>\n${task_description}\n</task>\n\nExecute this task autonomously. Return ONLY the final result or answer.`;

    try {
      // Dispatch sub-agent in an isolated SQLite session
      const targetSessionId = startAgent(fullPrompt, {
        userId,
        permissionMode: 'bypassPermissions',
        maxTurns: 30,
      });

      let finalResult = 'No result returned.';
      const SUB_AGENT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

      const completionPromise = new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          agentEvents.off('event', onEvent);
          reject(new Error('Sub-agent timed out'));
        }, SUB_AGENT_TIMEOUT_MS);

        function onEvent(event) {
          if (event.sessionId !== targetSessionId) return;

          if (event.type === 'result') {
            finalResult = event.content?.result || event.content?.last_assistant_message || '';
          }

          if (event.type === 'done') {
            clearTimeout(timeoutId);
            agentEvents.off('event', onEvent);
            const status = event.content?.status || 'completed';
            if (status === 'completed') {
              resolve(finalResult);
            } else {
              reject(new Error(`Sub-agent ended with status: ${status}`));
            }
          }
        }
        agentEvents.on('event', onEvent);
      });

      const outcome = await completionPromise;

      return {
        content: [
          {
            type: 'text',
            text: `[Sub-Agent Task Completed Successfully]\nOutcome Report:\n${outcome}`,
          },
        ],
        isError: false,
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text',
            text: `[Sub-Agent Execution Failed]\nError: ${err.message}`,
          },
        ],
        isError: true,
      };
    }
  }
}
