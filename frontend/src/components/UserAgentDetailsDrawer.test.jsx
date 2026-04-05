// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import UserAgentDetailsDrawer from './UserAgentDetailsDrawer.jsx';

vi.mock('./UserAgentDetailsDrawer.module.css', () => ({
  default: {
    root: 'root',
    backdrop: 'backdrop',
    panel: 'panel',
    toolbar: 'toolbar',
    title: 'title',
    closeBtn: 'closeBtn',
    body: 'body',
  },
}));

describe('UserAgentDetailsDrawer', () => {
  it('renders dialog with aria-modal and calls onClose on Escape', () => {
    const onClose = vi.fn();
    render(
      <UserAgentDetailsDrawer open onClose={onClose}>
        <p>Panel body</p>
      </UserAgentDetailsDrawer>,
    );

    const dialog = screen.getByRole('dialog', { name: /details/i });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('Panel body')).toBeTruthy();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('focuses the close control when opened (focus trap entry point)', () => {
    render(
      <UserAgentDetailsDrawer open onClose={vi.fn()}>
        <button type="button">Inside action</button>
      </UserAgentDetailsDrawer>,
    );
    const closeBtn = document.querySelector('[data-drawer-close]');
    expect(closeBtn).toBeTruthy();
    expect(document.activeElement).toBe(closeBtn);
  });

  it('does not render when closed', () => {
    render(
      <UserAgentDetailsDrawer open={false} onClose={vi.fn()}>
        <p>Hidden</p>
      </UserAgentDetailsDrawer>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
