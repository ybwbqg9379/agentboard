// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ChatInput from './ChatInput.jsx';

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

    expect(screen.getByRole('button', { name: 'Run' }).disabled).toBe(true);
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

    expect(screen.getByRole('button', { name: 'Stop' }).disabled).toBe(true);
  });

  it('sends start with bypassPermissions when connected', () => {
    const onSend = vi.fn();
    render(
      <ChatInput
        connected
        onSend={onSend}
        onFollowUp={vi.fn()}
        onStop={vi.fn()}
        status="idle"
        sessionId={null}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('Enter a task for the agent...'), {
      target: { value: 'hello' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    expect(onSend).toHaveBeenCalledWith('hello', { permissionMode: 'bypassPermissions' });
  });
});
