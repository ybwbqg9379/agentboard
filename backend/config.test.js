/**
 * config.js defaults and environment overrides (isolated via dynamic import).
 */

import { describe, it, expect, afterEach, vi } from 'vitest';

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

describe('config', () => {
  it('applies PORT and LLM_MODEL from environment when set', async () => {
    process.env.PORT = '3999';
    process.env.LLM_MODEL = 'custom-model';
    vi.resetModules();
    const config = (await import('./config.js')).default;
    expect(config.port).toBe(3999);
    expect(config.llm.model).toBe('custom-model');
  });

  it('defaults port to 3001 and model to gpt-4o-mini when env unset', async () => {
    delete process.env.PORT;
    delete process.env.LLM_MODEL;
    vi.resetModules();
    const config = (await import('./config.js')).default;
    expect(config.port).toBe(3001);
    expect(config.llm.model).toBe('gpt-4o-mini');
  });

  it('exposes proxy url from PROXY_URL or localhost default', async () => {
    process.env.PROXY_URL = 'http://custom-proxy:4000';
    vi.resetModules();
    let config = (await import('./config.js')).default;
    expect(config.proxy.url).toBe('http://custom-proxy:4000');

    delete process.env.PROXY_URL;
    process.env.PROXY_PORT = '5000';
    vi.resetModules();
    config = (await import('./config.js')).default;
    expect(config.proxy.url).toContain('5000');
  });

  it('parses agent timeout from AGENT_TIMEOUT', async () => {
    process.env.AGENT_TIMEOUT = '120000';
    vi.resetModules();
    const config = (await import('./config.js')).default;
    expect(config.agentTimeout).toBe(120_000);
  });

  it('compressSystemPrompt defaults true unless COMPRESS_SYSTEM_PROMPT is false', async () => {
    delete process.env.COMPRESS_SYSTEM_PROMPT;
    vi.resetModules();
    const c = (await import('./config.js')).default;
    expect(c.llm.compressSystemPrompt).toBe(true);

    process.env.COMPRESS_SYSTEM_PROMPT = 'false';
    vi.resetModules();
    const c2 = (await import('./config.js')).default;
    expect(c2.llm.compressSystemPrompt).toBe(false);
  });
});
