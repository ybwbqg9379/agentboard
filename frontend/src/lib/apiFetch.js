import { withClientAuth } from './clientAuth.js';

const DEFAULT_TIMEOUT_MS = 30_000;

export class ApiFetchError extends Error {
  /**
   * @param {string} message
   * @param {{ cause?: unknown; isTimeout?: boolean; isUserAbort?: boolean }} [opts]
   */
  constructor(message, opts = {}) {
    super(message, opts.cause ? { cause: opts.cause } : undefined);
    this.name = 'ApiFetchError';
    this.isTimeout = Boolean(opts.isTimeout);
    this.isUserAbort = Boolean(opts.isUserAbort);
  }
}

function mergeAbortSignals(userSignal, timeoutMs) {
  if (timeoutMs <= 0) return userSignal || undefined;
  const hasTimeout =
    typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function';
  if (!hasTimeout) return userSignal || undefined;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (!userSignal) return timeoutSignal;
  if (typeof AbortSignal.any === 'function') {
    return AbortSignal.any([userSignal, timeoutSignal]);
  }
  console.warn(
    '[apiFetch] AbortSignal.any is missing; timeout is not combined with the caller AbortSignal — only the caller signal is used',
  );
  return userSignal;
}

/**
 * Same as fetch but merges {@link withClientAuth} and applies a default timeout
 * (merged with any caller-supplied signal via AbortSignal.any when available).
 * Aborts throw {@link ApiFetchError} with `isTimeout` / `isUserAbort` when distinguishable.
 */
export async function apiFetch(input, init = {}) {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...userInit } = init;
  const merged = withClientAuth(userInit);
  const userSignal = merged.signal;
  const signal = mergeAbortSignals(userSignal, timeoutMs);

  try {
    return await fetch(input, { ...merged, signal });
  } catch (err) {
    const name = err?.name;
    if (name === 'AbortError' || name === 'TimeoutError') {
      const userAlreadyAborted = Boolean(userSignal?.aborted);
      const isTimeout =
        name === 'TimeoutError' || (timeoutMs > 0 && name === 'AbortError' && !userAlreadyAborted);
      const isUserAbort = name === 'AbortError' && userAlreadyAborted;
      const message = isTimeout ? 'Request timed out' : 'Request aborted';
      throw new ApiFetchError(message, { cause: err, isTimeout, isUserAbort });
    }
    throw err;
  }
}
