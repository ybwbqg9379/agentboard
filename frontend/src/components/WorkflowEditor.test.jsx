// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import WorkflowEditor from './WorkflowEditor.jsx';
import { __resetSharedWebSocketsForTests } from '../lib/sharedWebSocket.js';

vi.mock('../lib/clientAuth.js', () => ({
  buildWsUrl: () => 'ws://localhost/ws',
  withClientAuth: (init = {}) => init,
}));

let sockets = [];

class MockWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = MockWebSocket.CONNECTING;
    this.onopen = null;
    this.onclose = null;
    this.onerror = null;
    this.onmessage = null;
    this.listeners = { open: [], close: [], error: [], message: [] };
    this.closeCalls = 0;
    sockets.push(this);
  }

  addEventListener(type, handler) {
    this.listeners[type]?.push(handler);
  }

  removeEventListener(type, handler) {
    this.listeners[type] = (this.listeners[type] || []).filter((item) => item !== handler);
  }

  send() {}

  close() {
    this.closeCalls += 1;
    this.readyState = MockWebSocket.CLOSED;
    this.emit('close');
  }

  emit(type, event = {}) {
    const callback = this[`on${type}`];
    if (typeof callback === 'function') {
      callback(event);
    }
    for (const handler of this.listeners[type] || []) {
      handler(event);
    }
  }
}

MockWebSocket.CONNECTING = 0;
MockWebSocket.OPEN = 1;
MockWebSocket.CLOSED = 3;

vi.stubGlobal('WebSocket', MockWebSocket);
vi.stubGlobal('fetch', vi.fn());

function jsonResponse(data) {
  return {
    ok: true,
    json: async () => data,
  };
}

describe('WorkflowEditor', () => {
  beforeEach(() => {
    sockets = [];
    __resetSharedWebSocketsForTests();
    vi.useFakeTimers();
    fetch.mockResolvedValue(jsonResponse({ workflows: [] }));
  });

  afterEach(() => {
    __resetSharedWebSocketsForTests();
    vi.useRealTimers();
  });

  it('reconnects the workflow socket after it closes', async () => {
    render(<WorkflowEditor />);

    await act(async () => {
      await Promise.resolve();
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(sockets).toHaveLength(1);

    act(() => {
      sockets[0].readyState = MockWebSocket.CLOSED;
      sockets[0].emit('close');
      vi.advanceTimersByTime(3000);
    });

    expect(sockets).toHaveLength(2);
  });

  it('reuses the shared socket across an immediate remount', async () => {
    const first = render(<WorkflowEditor />);

    await act(async () => {
      await Promise.resolve();
    });
    expect(sockets).toHaveLength(1);
    const initialSocket = sockets[0];

    act(() => {
      first.unmount();
    });

    render(<WorkflowEditor />);

    await act(async () => {
      await Promise.resolve();
    });
    expect(sockets).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(150);
    });

    expect(initialSocket.closeCalls).toBe(0);
  });
});
