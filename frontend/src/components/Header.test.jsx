// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import Header from './Header.jsx';

vi.mock('./Dropdown', () => ({
  default: ({ title }) => <div data-testid={`dropdown-${title}`}>{title}</div>,
}));

vi.mock('./Dropdown.module.css', () => ({
  default: {
    triggerFluid: 'triggerFluid',
  },
}));

vi.mock('./Header.module.css', () => ({
  default: {
    header: 'header',
    left: 'left',
    logo: 'logo',
    version: 'version',
    shellTabs: 'shellTabs',
    shellTab: 'shellTab',
    shellTabActive: 'shellTabActive',
    agentShellNavHint: 'agentShellNavHint',
    modeTabs: 'modeTabs',
    modeTab: 'modeTab',
    modeActive: 'modeActive',
    right: 'right',
    chromeCluster: 'chromeCluster',
    trailingCluster: 'trailingCluster',
    trailingLead: 'trailingLead',
    sessionActions: 'sessionActions',
    themePackWrap: 'themePackWrap',
    visuallyHidden: 'visuallyHidden',
    headerBtnIcon: 'headerBtnIcon',
    historyBtn: 'historyBtn',
    clearBtn: 'clearBtn',
    mcpHealth: 'mcpHealth',
    mcpLabel: 'mcpLabel',
    mcpGlyph: 'mcpGlyph',
    connStatus: 'connStatus',
    connIcon: 'connIcon',
    connIconMuted: 'connIconMuted',
    connText: 'connText',
  },
}));

function renderHeader(overrides = {}) {
  const props = {
    connected: true,
    sessionId: 'session-1',
    onClear: vi.fn(),
    onOpenHistory: vi.fn(),
    mcpHealth: {},
    mode: 'agent',
    onModeChange: vi.fn(),
    theme: 'light',
    onThemeChange: vi.fn(),
    themePack: 'claude',
    onThemePackChange: vi.fn(),
    density: 'comfortable',
    onDensityChange: vi.fn(),
    uiShell: 'agent',
    onUiShellChange: vi.fn(),
    onOpenUserDetails: vi.fn(),
    ...overrides,
  };

  return {
    ...render(<Header {...props} />),
    props,
  };
}

describe('Header', () => {
  it('exposes the active shell button through aria-pressed', () => {
    const { props } = renderHeader();

    const consoleBtn = screen.getByRole('button', { name: 'Console' });
    const agentBtn = screen.getByRole('button', { name: 'Agent' });

    expect(consoleBtn).toHaveAttribute('aria-pressed', 'false');
    expect(agentBtn).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/switch to Console first/i)).toBeTruthy();

    fireEvent.click(consoleBtn);
    expect(props.onUiShellChange).toHaveBeenCalledWith('pro');
  });

  it('marks Console as pressed when the pro shell is active', () => {
    renderHeader({ uiShell: 'pro' });
    const shellGroup = screen.getByRole('group', { name: 'Interface mode' });

    expect(within(shellGroup).getByRole('button', { name: 'Console' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(shellGroup).getByRole('button', { name: 'Agent' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });
});
