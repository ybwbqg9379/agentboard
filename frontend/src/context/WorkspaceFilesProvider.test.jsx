// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

const { mockApiFetch } = vi.hoisted(() => ({
  mockApiFetch: vi.fn(),
}));

vi.mock('../lib/apiFetch.js', () => ({
  API_BASE: '',
  apiFetch: mockApiFetch,
}));

import { WorkspaceFilesProvider, useWorkspaceFiles } from './WorkspaceFilesProvider.jsx';

function WorkspaceFilesProbe({ sessionId, refreshKey = 0 }) {
  return (
    <WorkspaceFilesProvider sessionId={sessionId} refreshKey={refreshKey}>
      <WorkspaceFilesConsumer />
    </WorkspaceFilesProvider>
  );
}

function WorkspaceFilesConsumer() {
  const { workspaceList, workspaceLoading } = useWorkspaceFiles();
  return (
    <>
      <div data-testid="workspace-list">
        {workspaceList.map((file) => file.name).join(',') || '(empty)'}
      </div>
      <div data-testid="workspace-loading">{String(workspaceLoading)}</div>
    </>
  );
}

async function flushWorkspaceFetch() {
  await act(async () => {
    await Promise.resolve();
    vi.advanceTimersByTime(350);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('WorkspaceFilesProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockApiFetch.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('clears the previous session file list immediately when sessionId changes', async () => {
    mockApiFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ files: [{ name: 'old.pdf' }] }),
    });

    const { rerender } = render(<WorkspaceFilesProbe sessionId="sess-a" />);
    await flushWorkspaceFetch();

    expect(screen.getByTestId('workspace-list').textContent).toBe('old.pdf');

    let resolveNextFetch;
    mockApiFetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveNextFetch = resolve;
        }),
    );

    rerender(<WorkspaceFilesProbe sessionId="sess-b" />);

    expect(screen.getByTestId('workspace-list').textContent).toBe('(empty)');
    expect(screen.getByTestId('workspace-loading').textContent).toBe('true');

    await act(async () => {
      vi.advanceTimersByTime(350);
    });

    resolveNextFetch({
      ok: true,
      json: async () => ({ files: [{ name: 'new.pdf' }] }),
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId('workspace-list').textContent).toBe('new.pdf');
  });
});
