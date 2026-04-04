import { describe, it, expect } from 'vitest';
import { VisualizerTool } from './VisualizerTool.js';

describe('VisualizerTool', () => {
  const tool = new VisualizerTool();

  it('should generate a valid mermaid output with correct input', async () => {
    const input = {
      syntax: 'graph TD; A-->B;',
      title: 'Simple Flow',
      format: 'svg',
    };
    const context = { sessionId: 'test-session' };

    const result = await tool.call(input, context);

    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain('Simple Flow');
    expect(result.content[0].text).toContain('MERMAID_DEFINITION');
    expect(result.content[0].text).toContain('graph TD; A-->B;');
  });

  it('should return error for invalid mermaid keywords', async () => {
    const input = {
      syntax: 'invalid syntax starting with random word',
    };
    const context = { sessionId: 'test-session' };

    const result = await tool.call(input, context);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Invalid Mermaid syntax');
  });

  it('should use default format if not provided', async () => {
    const input = {
      syntax: 'pie title Pets; "Dogs": 386; "Cats": 85;',
    };
    const context = { sessionId: 'test-session' };

    const result = await tool.call(input, context);

    expect(result.isError).toBe(false);
    expect(result.content[0].text).toContain('Format: SVG');
  });
});
