/**
 * Environment validation helpers (no process.exit — use getEnvValidationError).
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { assertValidEnv, EnvValidationError, getEnvValidationError } from './env.js';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  vi.resetModules();
  for (const k of Object.keys(process.env)) {
    if (!(k in ORIGINAL_ENV)) delete process.env[k];
  }
  for (const [k, v] of Object.entries(ORIGINAL_ENV)) {
    process.env[k] = v;
  }
});

describe('getEnvValidationError', () => {
  it('returns null when PORT and AGENT_TIMEOUT are valid', () => {
    process.env.PORT = '3001';
    process.env.AGENT_TIMEOUT = '600000';
    expect(getEnvValidationError()).toBeNull();
  });

  it('returns null when PORT and AGENT_TIMEOUT are unset (defaults apply)', () => {
    delete process.env.PORT;
    delete process.env.AGENT_TIMEOUT;
    expect(getEnvValidationError()).toBeNull();
  });

  it('returns an error when PORT is not a number', () => {
    process.env.PORT = 'abc';
    expect(getEnvValidationError()).not.toBeNull();
  });

  it('returns an error when PORT is out of range', () => {
    process.env.PORT = '99999';
    expect(getEnvValidationError()).not.toBeNull();
  });

  it('returns an error when AGENT_TIMEOUT is too small', () => {
    process.env.AGENT_TIMEOUT = '50';
    expect(getEnvValidationError()).not.toBeNull();
  });
});

describe('assertValidEnv', () => {
  it('throws EnvValidationError instead of exiting the process', () => {
    process.env.PORT = 'not-a-port';
    expect(() => assertValidEnv()).toThrow(EnvValidationError);
  });
});
