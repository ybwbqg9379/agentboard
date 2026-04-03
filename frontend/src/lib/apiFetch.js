import { withClientAuth } from './clientAuth.js';

const DEFAULT_TIMEOUT_MS = 30_000;

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
  return userSignal;
}

/**
 * Same as fetch but merges {@link withClientAuth} and applies a default timeout
 * (merged with any caller-supplied signal via AbortSignal.any when available).
 */
export async function apiFetch(input, init = {}) {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...userInit } = init;
  const merged = withClientAuth(userInit);
  const signal = mergeAbortSignals(merged.signal, timeoutMs);
  return fetch(input, { ...merged, signal });
}
