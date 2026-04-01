import { describe, it, expect } from 'vitest';
import {
  buildWsUrl,
  getAuthToken,
  getUserId,
  normalizeUserId,
  withClientAuth,
} from './clientAuth.js';

function createStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, value);
    },
  };
}

describe('clientAuth', () => {
  it('prefers token from query string over storage', () => {
    const storage = createStorage({ agentboard_api_key: 'stored-token' });
    expect(getAuthToken({ search: '?token=query-token', storage })).toBe('query-token');
  });

  it('persists user_id from query string into storage', () => {
    const storage = createStorage();
    expect(getUserId({ search: '?user_id=tenant-9', storage })).toBe('tenant-9');
    expect(storage.getItem('agentboard_user_id')).toBe('tenant-9');
  });

  it('falls back to stored user_id and then to default', () => {
    expect(getUserId({ storage: createStorage({ agentboard_user_id: 'tenant-a' }) })).toBe(
      'tenant-a',
    );
    expect(getUserId({ storage: createStorage() })).toBe('default');
  });

  it('normalizes user IDs and rejects invalid values', () => {
    expect(normalizeUserId('user.alpha-1')).toBe('user.alpha-1');
    expect(normalizeUserId('../bad')).toBeNull();
  });

  it('adds Authorization and x-user-id headers to fetch init', () => {
    const storage = createStorage({
      agentboard_api_key: 'stored-token',
      agentboard_user_id: 'tenant-a',
    });
    const init = withClientAuth(
      {
        headers: { 'Content-Type': 'application/json' },
      },
      { storage },
    );

    expect(init.headers.get('Content-Type')).toBe('application/json');
    expect(init.headers.get('Authorization')).toBe('Bearer stored-token');
    expect(init.headers.get('x-user-id')).toBe('tenant-a');
  });

  it('builds websocket URL with token and user_id', () => {
    const storage = createStorage({
      agentboard_api_key: 'stored-token',
      agentboard_user_id: 'tenant-a',
    });
    const wsUrl = buildWsUrl('/ws', {
      storage,
      location: {
        protocol: 'https:',
        host: 'agentboard.test',
        search: '',
      },
    });

    expect(wsUrl).toBe('wss://agentboard.test/ws?token=stored-token&user_id=tenant-a');
  });
});
