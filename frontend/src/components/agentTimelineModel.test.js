import { describe, it, expect } from 'vitest';
import i18n from '../i18n.js';
import {
  buildDisplayItems,
  buildUserShellDisplayItems,
  isUserShellTimelineItem,
} from './agentTimelineModel.js';

describe('buildUserShellDisplayItems', () => {
  it('omits tool_use, tool_result, thinking; keeps assistant text', async () => {
    await i18n.changeLanguage('en');
    const events = [
      {
        type: 'assistant',
        timestamp: '2026-01-01T00:00:00Z',
        content: {
          content: [
            { type: 'thinking', thinking: 'internal' },
            { type: 'text', text: 'Hello user' },
            { type: 'tool_use', name: 'Bash', input: { command: 'ls' } },
            { type: 'tool_result', content: 'out', tool_use_id: '1' },
          ],
        },
      },
    ];
    const full = buildDisplayItems(events);
    const user = buildUserShellDisplayItems(events);
    expect(full.length).toBeGreaterThan(user.length);
    expect(user.some((i) => i.kind === 'tool_use')).toBe(false);
    expect(user.some((i) => i.kind === 'tool_result')).toBe(false);
    expect(user.some((i) => i.kind === 'thinking')).toBe(false);
    expect(user.some((i) => i.body === 'Hello user')).toBe(true);
  });

  it('isUserShellTimelineItem reflects hidden set', () => {
    expect(isUserShellTimelineItem({ kind: 'assistant' })).toBe(true);
    expect(isUserShellTimelineItem({ kind: 'tool_use' })).toBe(false);
    expect(isUserShellTimelineItem({ kind: 'tool_progress' })).toBe(false);
  });
});
