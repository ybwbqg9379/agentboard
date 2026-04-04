import { Tool } from './Tool.js';

/**
 * VisualizerTool: Independent worker for generating diagrams and charts.
 * Supports Mermaid syntax and provides static asset path generation.
 */
export class VisualizerTool extends Tool {
  constructor() {
    super({
      name: 'VisualizerTool',
      description:
        'Transform structured text into visual diagrams (Flowcharts, Gantt, Sequence Diagrams). Uses Mermaid syntax. Note: Do NOT generate interactive elements like "click" events or "href" links as they are disabled for security reasons.',
      inputSchema: {
        type: 'object',
        properties: {
          syntax: {
            type: 'string',
            description: 'The diagram definition in Mermaid syntax (e.g., "graph TD; A-->B;").',
          },
          title: {
            type: 'string',
            description: 'Optional title for the diagram.',
          },
          format: {
            type: 'string',
            description: 'Desired output format. Options are "svg" or "png". Default is "svg".',
            enum: ['svg', 'png'],
          },
        },
        required: ['syntax'],
      },
      isConcurrencySafe: true,
      isDangerous: false,
    });
  }

  async call(input, context) {
    const { syntax, title, format = 'svg' } = input;
    const { sessionId } = context;

    // TODO: Future enhancement - Use local puppeteer/playwright to render to static file
    // For now, we validate the syntax and return a renderable block for the UI/Report

    // Basic validation of mermaid keywords
    const keywords = [
      'graph',
      'sequenceDiagram',
      'gantt',
      'classDiagram',
      'stateDiagram',
      'erDiagram',
      'journey',
      'pie',
      'mindmap',
      'timeline',
    ];
    const hasKeyword = keywords.some((k) => syntax.trim().startsWith(k));

    if (!hasKeyword) {
      return {
        content: [
          {
            type: 'text',
            text: '[Error] Invalid Mermaid syntax. Must start with a recognized keyword (e.g., graph, sequenceDiagram).',
          },
        ],
        isError: true,
      };
    }

    // In a real "independent worker" scenario, we would save this to a file
    const resultText = `[Visualizer Output]
Generated Diagram: ${title || 'Untitled'}
Format: ${format.toUpperCase()}
Session ID: ${sessionId}

MERMAID_DEFINITION:
\`\`\`mermaid
${syntax}
\`\`\`
`;

    return {
      content: [
        {
          type: 'text',
          text: resultText.trim(),
        },
      ],
      isError: false,
    };
  }
}
