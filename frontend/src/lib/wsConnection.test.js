import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  touchWsLastActivity,
  startWsHeartbeat,
  WS_HEARTBEAT_INTERVAL_MS,
  WS_PONG_TIMEOUT_MS,
} from './wsConnection.js';

describe('wsConnection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('touchWsLastActivity updates ref to Date.now()', () => {
    vi.setSystemTime(1_234_567);
    const ref = { current: 0 };
    touchWsLastActivity(ref);
    expect(ref.current).toBe(1_234_567);
  });

  it('startWsHeartbeat sends ping when socket is open', () => {
    const ref = { current: 0 };
    const ws = {
      readyState: 1, // WebSocket.OPEN
      send: vi.fn(),
      close: vi.fn(),
    };
    const id = startWsHeartbeat(ws, ref, {
      intervalMs: WS_HEARTBEAT_INTERVAL_MS,
      pongTimeoutMs: WS_PONG_TIMEOUT_MS,
    });
    vi.advanceTimersByTime(WS_HEARTBEAT_INTERVAL_MS);
    expect(ws.send).toHaveBeenCalledWith('ping');
    expect(ws.close).not.toHaveBeenCalled();
    clearInterval(id);
  });

  it('closes socket when idle past pong timeout', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ref = { current: 0 };
    const ws = {
      readyState: 1,
      send: vi.fn(),
      close: vi.fn(),
    };
    const id = startWsHeartbeat(ws, ref, {
      logLabel: 'test',
      intervalMs: WS_HEARTBEAT_INTERVAL_MS,
      pongTimeoutMs: 1000,
    });
    vi.advanceTimersByTime(WS_HEARTBEAT_INTERVAL_MS);
    expect(ws.close).toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalled();
    clearInterval(id);
  });

  it('closes without console.warn when logLabel omitted', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ref = { current: 0 };
    const ws = {
      readyState: 1,
      send: vi.fn(),
      close: vi.fn(),
    };
    const id = startWsHeartbeat(ws, ref, {
      intervalMs: WS_HEARTBEAT_INTERVAL_MS,
      pongTimeoutMs: 1000,
    });
    vi.advanceTimersByTime(WS_HEARTBEAT_INTERVAL_MS);
    expect(ws.close).toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
    clearInterval(id);
  });

  it('does not send ping when socket is not open', () => {
    const ref = { current: Date.now() };
    const ws = {
      readyState: 0, // WebSocket.CONNECTING
      send: vi.fn(),
      close: vi.fn(),
    };
    const id = startWsHeartbeat(ws, ref);
    vi.advanceTimersByTime(WS_HEARTBEAT_INTERVAL_MS);
    expect(ws.send).not.toHaveBeenCalled();
    clearInterval(id);
  });
});
