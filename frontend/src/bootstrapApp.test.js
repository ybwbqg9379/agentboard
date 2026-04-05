// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { bootstrapApp } from './bootstrapApp.js';

describe('bootstrapApp', () => {
  it('mounts immediately without waiting for theme font preloading', () => {
    const order = [];
    let resolvePreload;
    const preloadPromise = new Promise((resolve) => {
      resolvePreload = resolve;
    });

    const applyAppearance = vi.fn(() => {
      order.push('apply');
    });
    const preloadFonts = vi.fn(() => {
      order.push('preload');
      return preloadPromise;
    });
    const mountRoot = vi.fn(() => {
      order.push('mount');
    });

    bootstrapApp({ applyAppearance, preloadFonts, mountRoot });

    expect(applyAppearance).toHaveBeenCalledTimes(1);
    expect(preloadFonts).toHaveBeenCalledTimes(1);
    expect(mountRoot).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['apply', 'preload', 'mount']);

    resolvePreload();
  });

  it('swallows preload failures and still mounts the app', async () => {
    const mountRoot = vi.fn();

    bootstrapApp({
      applyAppearance: vi.fn(),
      preloadFonts: vi.fn(() => Promise.reject(new Error('chunk failed'))),
      mountRoot,
    });

    await Promise.resolve();
    expect(mountRoot).toHaveBeenCalledTimes(1);
  });
});
