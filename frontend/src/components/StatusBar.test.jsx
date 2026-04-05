// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import StatusBar from './StatusBar.jsx';

describe('StatusBar', () => {
  let warnSpy;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('renders interrupted sessions with a localized label and no dev warning', () => {
    render(
      <StatusBar
        status="interrupted"
        sessionId="12345678-abcd-1234-abcd-1234567890ab"
        eventCount={0}
        sessionStats={null}
        subtasks={{}}
      />,
    );

    expect(screen.getByText('Interrupted')).toBeInTheDocument();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('warns and falls back to the raw label for unknown statuses', async () => {
    render(
      <StatusBar
        status="queued"
        sessionId={null}
        eventCount={0}
        sessionStats={null}
        subtasks={{}}
      />,
    );

    expect(screen.getByText('queued')).toBeInTheDocument();
    await waitFor(() => {
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('queued'));
    });
  });
});
