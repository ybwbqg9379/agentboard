/**
 * Unit tests for supabaseClient singleton initialization.
 *
 * Verifies fail-fast behavior in non-test environments
 * and graceful fallback in test environments.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

beforeEach(() => {
  vi.resetModules();
});

describe('supabaseClient', () => {
  it('exports a supabase client with from() method in test env', async () => {
    const { default: supabase } = await import('./supabaseClient.js');
    expect(supabase).toBeDefined();
    expect(typeof supabase.from).toBe('function');
  });

  it('uses fallback URL and key in test environment', async () => {
    // VITEST env var is set automatically, so this import succeeds
    // even without SUPABASE_URL / SUPABASE_SECRET_KEY
    const { default: supabase } = await import('./supabaseClient.js');
    expect(supabase).toBeDefined();
  });

  it('throws when SUPABASE_URL missing in non-test env', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITEST', '');

    // Need to mock config to return no supabaseUrl
    vi.doMock('./config.js', () => ({
      default: { supabaseUrl: '', supabaseServiceKey: 'some-key' },
    }));

    await expect(import('./supabaseClient.js')).rejects.toThrow('SUPABASE_URL is not configured');

    vi.unstubAllEnvs();
  });

  it('throws when SUPABASE_SECRET_KEY missing in non-test env', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VITEST', '');

    vi.doMock('./config.js', () => ({
      default: { supabaseUrl: 'https://example.supabase.co', supabaseServiceKey: '' },
    }));

    await expect(import('./supabaseClient.js')).rejects.toThrow(
      'SUPABASE_SECRET_KEY is not configured',
    );

    vi.unstubAllEnvs();
  });
});
