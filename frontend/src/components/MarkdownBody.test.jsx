// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import MarkdownBody from './MarkdownBody.jsx';

const mermaidInitialize = vi.fn();
const mermaidRun = vi.fn(async () => {});

vi.mock('mermaid', () => ({
  default: {
    initialize: mermaidInitialize,
    run: mermaidRun,
  },
}));

describe('MarkdownBody', () => {
  beforeEach(() => {
    mermaidInitialize.mockClear();
    mermaidRun.mockClear();
    delete window.__markdownBodyXss;
  });

  it('renders mermaid blocks without parsing embedded HTML', async () => {
    const maliciousDiagram = [
      'graph TD',
      'A["<img src=x onerror=\\"window.__markdownBodyXss=true\\">"] --> B',
    ].join('\n');

    const { container } = render(
      <MarkdownBody>{`\
\`\`\`mermaid
${maliciousDiagram}
\`\`\`
`}</MarkdownBody>,
    );

    await waitFor(() => {
      expect(mermaidRun).toHaveBeenCalled();
    });

    const mermaidNode = container.querySelector('.mermaid');
    expect(mermaidNode).not.toBeNull();
    expect(mermaidNode.querySelector('img')).toBeNull();
    expect(mermaidNode.textContent).toContain('<img src=x onerror=');
    expect(window.__markdownBodyXss).toBeUndefined();
    expect(mermaidInitialize).toHaveBeenCalledWith(
      expect.objectContaining({
        securityLevel: 'strict',
      }),
    );
  });
});
