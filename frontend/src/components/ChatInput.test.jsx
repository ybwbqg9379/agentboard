// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ChatInput from './ChatInput.jsx';

vi.mock('./Dropdown.jsx', () => ({
  default: ({ disabled }) => <div data-testid="mode-select" data-disabled={String(disabled)} />,
}));

describe('ChatInput', () => {
  it('disables submit when disconnected', () => {
    render(
      <ChatInput
        connected={false}
        onSend={vi.fn()}
        onFollowUp={vi.fn()}
        onStop={vi.fn()}
        status="idle"
        sessionId={null}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('Waiting for connection...'), {
      target: { value: 'run task' },
    });

    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled();
  });

  it('disables stop when disconnected during a running session', () => {
    render(
      <ChatInput
        connected={false}
        onSend={vi.fn()}
        onFollowUp={vi.fn()}
        onStop={vi.fn()}
        status="running"
        sessionId="session-1"
      />,
    );

    expect(screen.getByRole('button', { name: 'Stop' })).toBeDisabled();
  });
});
