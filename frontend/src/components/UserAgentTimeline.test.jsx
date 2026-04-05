// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
    tableWrap: 'tableWrap',
    jsonTable: 'jsonTable',
    downloadBtn: 'downloadBtn',
    downloadIcon: 'downloadIcon',
  },
}));

describe('UserAgentTimeline', () => {
  it('shows empty state when idle and there are no events', () => {
    render(<UserAgentTimeline events={[]} status="idle" sessionId={null} />);
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
    render(<UserAgentTimeline events={events} status="idle" sessionId="s1" />);
    expect(screen.getByRole('heading', { name: /activity/i })).toBeTruthy();
    expect(screen.getByText('1 events')).toBeTruthy();
    expect(screen.getByRole('heading', { name: /assistant/i })).toBeTruthy();
  });
});
