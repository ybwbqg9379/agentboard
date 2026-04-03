/**
 * Startup validation for process.env — fail fast on malformed numeric config.
 */

import { z } from 'zod';

const portSchema = z.preprocess(
  (v) => (v === undefined || v === '' ? '3001' : String(v)),
  z
    .string()
    .regex(/^\d+$/, 'PORT must be a decimal integer')
    .transform((s) => parseInt(s, 10))
    .pipe(z.number().int().min(1).max(65535)),
);

const agentTimeoutSchema = z.preprocess(
  (v) => (v === undefined || v === '' ? '600000' : String(v)),
  z
    .string()
    .regex(/^\d+$/, 'AGENT_TIMEOUT must be a decimal integer')
    .transform((s) => parseInt(s, 10))
    .pipe(z.number().int().min(1000)),
);

const envSchema = z.object({
  PORT: portSchema,
  AGENT_TIMEOUT: agentTimeoutSchema,
});

/**
 * Returns a formatted error if env vars fail validation, else null.
 */
export function getEnvValidationError() {
  const result = envSchema.safeParse(process.env);
  return result.success ? null : result.error;
}

export function assertValidEnv() {
  const err = getEnvValidationError();
  if (err) {
    console.error('[env] Invalid environment:', err.format());
    process.exit(1);
  }
}

export function isProduction() {
  return process.env.NODE_ENV === 'production';
}
