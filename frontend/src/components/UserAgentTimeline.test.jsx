// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import i18n from '../i18n.js';
import UserAgentTimeline from './UserAgentTimeline.jsx';

vi.mock('./UserAgentTimeline.module.css', () => ({
  default: {
    emptyWrap: 'emptyWrap',
    emptyInner: 'emptyInner',
    emptyIcon: 'emptyIcon',
    emptyTitle: 'emptyTitle',
    emptyHint: 'emptyHint',
    scrollArea: 'scrollArea',
    feedTop: 'feedTop',
    feedHeading: 'feedHeading',
    feedMeta: 'feedMeta',
    feedList: 'feedList',
    milestone: 'milestone',
    milestoneGutter: 'milestoneGutter',
    milestoneLine: 'milestoneLine',
    milestoneBody: 'milestoneBody',
    milestoneHeader: 'milestoneHeader',
    milestoneTitle: 'milestoneTitle',
    milestoneTime: 'milestoneTime',
    milestoneRich: 'milestoneRich',
    milestonePlain: 'milestonePlain',
    runningRow: 'runningRow',
    runningLabel: 'runningLabel',
    toolsOnlyNote: 'toolsOnlyNote',
    tableWrap: 'tableWrap',
    jsonTable: 'jsonTable',
    downloadBtn: 'downloadBtn',
    downloadIcon: 'downloadIcon',
  },
}));

describe('UserAgentTimeline', () => {
  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage('en');
  });

  it('shows empty state when idle and there are no events', () => {
    render(<UserAgentTimeline events={[]} status="idle" />);
    expect(screen.getByRole('heading', { name: /ready for a task/i })).toBeTruthy();
    expect(screen.getByText(/describe what you want done/i)).toBeTruthy();
  });

  it('renders feed heading and event count when events exist', () => {
    const events = [
      {
        type: 'assistant',
        timestamp: '2026-04-04T12:00:00.000Z',
        content: { text: 'Hello' },
      },
    ];
    render(<UserAgentTimeline events={events} status="idle" />);
    expect(screen.getByRole('heading', { name: /activity/i })).toBeTruthy();
    expect(screen.getByText('1 event')).toBeTruthy();
    expect(screen.getByRole('heading', { name: /assistant/i })).toBeTruthy();
  });

  it('shows tools-only hidden note while running when events produce no user-visible rows', () => {
    const events = [
      {
        type: 'assistant',
        timestamp: '2026-04-04T12:00:00.000Z',
        content: {
          content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }],
        },
      },
    ];
    render(<UserAgentTimeline events={events} status="running" />);
    expect(screen.getByText(/this turn only ran tools/i)).toBeTruthy();
    expect(screen.getByText(/working through your task/i)).toBeTruthy();
  });

  it('recomputes translated timeline rows when the language changes', async () => {
    const events = [
      {
        type: 'assistant',
        timestamp: '2026-04-04T12:00:00.000Z',
        content: { text: 'Hello' },
      },
    ];

    render(<UserAgentTimeline events={events} status="idle" />);
    expect(screen.getByRole('heading', { name: /assistant/i })).toBeTruthy();
    expect(screen.getByText('1 event')).toBeTruthy();

    await act(async () => {
      await i18n.changeLanguage('zh-CN');
    });

    expect(screen.getByRole('heading', { name: '助手' })).toBeTruthy();
    expect(screen.getByText('1 条事件')).toBeTruthy();
  });
});
