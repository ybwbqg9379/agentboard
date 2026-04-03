// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { apiFetch } from './apiFetch.js';

vi.mock('./clientAuth.js', () => ({
  withClientAuth: (init = {}) => init,
}));

vi.stubGlobal(
  'fetch',
  vi.fn(() => Promise.resolve({ ok: true })),
);

describe('apiFetch', () => {
  beforeEach(() => {
    fetch.mockClear();
    fetch.mockResolvedValue({ ok: true });
  });

  it('invokes global fetch with method from init', async () => {
    await apiFetch('/api/x', { method: 'POST' });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('/api/x');
    expect(init.method).toBe('POST');
  });

  it('passes timeout as AbortSignal when AbortSignal.timeout exists', async () => {
    const timeoutFn = vi.fn(() => new AbortController().signal);
    const original = AbortSignal.timeout;
    AbortSignal.timeout = timeoutFn;
    try {
      await apiFetch('/api/y', { timeoutMs: 5000 });
      expect(timeoutFn).toHaveBeenCalledWith(5000);
    } finally {
      if (original) {
        AbortSignal.timeout = original;
      } else {
        delete AbortSignal.timeout;
      }
    }
  });

  it('uses caller signal combined with timeout via AbortSignal.any when available', async () => {
    const user = new AbortController();
    const anyFn = vi.fn((signals) => signals[0]);
    const originalAny = AbortSignal.any;
    AbortSignal.any = anyFn;
    const originalTimeout = AbortSignal.timeout;
    AbortSignal.timeout = () => new AbortController().signal;
    try {
      await apiFetch('/api/z', { signal: user.signal, timeoutMs: 1000 });
      expect(anyFn).toHaveBeenCalled();
    } finally {
      AbortSignal.any = originalAny;
      if (originalTimeout) AbortSignal.timeout = originalTimeout;
    }
  });
});
