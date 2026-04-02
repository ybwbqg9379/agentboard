// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SessionDrawer from './SessionDrawer.jsx';

vi.mock('../lib/clientAuth.js', () => ({
  withClientAuth: (init = {}) => init,
}));

vi.stubGlobal('fetch', vi.fn());

function session(id, prompt) {
  return {
    id,
    prompt,
    status: 'completed',
    stats: null,
    created_at: '2026-03-31T12:00:00.000Z',
  };
}

function jsonResponse(data) {
  return {
    ok: true,
    json: async () => data,
  };
}

describe('SessionDrawer', () => {
  beforeEach(() => {
    fetch.mockReset();
  });

  it('refreshes sessions after deletion so total stays accurate', async () => {
    fetch
      .mockResolvedValueOnce(
        jsonResponse({ sessions: [session('s1', 'First session')], total: 40 }),
      )
      .mockResolvedValueOnce(jsonResponse({ deleted: true }))
      .mockResolvedValueOnce(
        jsonResponse({ sessions: [session('s2', 'Second session')], total: 39 }),
      );

    render(
      <SessionDrawer open onClose={vi.fn()} onLoadSession={vi.fn()} currentSessionId={null} />,
    );

    await screen.findByText('40');
    fireEvent.click(screen.getByTitle('Delete session'));
    await screen.findByText('Delete this session and all its events?');
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(await screen.findByText('39')).toBeTruthy();
    expect(screen.getByText('Second session')).toBeTruthy();
  });
});
