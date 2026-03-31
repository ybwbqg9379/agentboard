import { Tool } from './Tool.js';
import { executeInSandbox } from './dockerSandbox.js';

export class REPLTool extends Tool {
  constructor() {
    super({
      name: 'REPLTool',
      description:
        "Execute arbitrary Javascript (node) or Python code in a secure, isolated sandbox to perform computations, data formatting, or validation. The script executes within the user's workspace bind mount.",
      inputSchema: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description: 'The code snippet to execute.',
          },
          language: {
            type: 'string',
            description:
              'The interpreter environment to run the code in. Options are "node" or "python".',
            enum: ['node', 'python'],
          },
        },
        required: ['code', 'language'],
      },
      isConcurrencySafe: true,
      isDangerous: false, // Protected by Docker, but still logs heavily
    });
  }

  async call(input, context) {
    const { code, language } = input;
    const { userWorkspace } = context;

    if (!userWorkspace) {
      throw new Error(`Execution Context Error: Missing userWorkspace isolation path.`);
    }

    try {
      const { stdout, stderr, exitCode } = await executeInSandbox(userWorkspace, code, language);

      let resText = `Exit Code: ${exitCode}\n`;
      if (stdout) resText += `STDOUT:\n${stdout}\n`;
      if (stderr) resText += `STDERR:\n${stderr}\n`;

      return {
        content: [
          {
            type: 'text',
            text: resText.trim(),
          },
        ],
        isError: exitCode !== 0,
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text',
            text: `[Sandbox Failure]\n${err.message}`,
          },
        ],
        isError: true,
      };
    }
  }
}
