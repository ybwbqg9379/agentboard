// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  STORAGE_KEYS,
  applyStoredDocumentAppearance,
  persistAppearance,
  readStoredAppearance,
} from './themePreferences.js';

function createStorage() {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
  };
}

describe('themePreferences', () => {
  let storage;

  beforeEach(() => {
    storage = createStorage();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-theme-pack');
    document.documentElement.removeAttribute('data-density');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads stored appearance values and applies them to the document root', () => {
    storage.setItem(STORAGE_KEYS.theme, 'dark');
    storage.setItem(STORAGE_KEYS.themePack, 'cursor');
    storage.setItem(STORAGE_KEYS.density, 'compact');

    const appearance = applyStoredDocumentAppearance({ storage });

    expect(appearance).toEqual({
      theme: 'dark',
      themePack: 'cursor',
      density: 'compact',
    });
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.dataset.themePack).toBe('cursor');
    expect(document.documentElement.dataset.density).toBe('compact');
  });

  it('falls back to safe defaults when stored values are invalid', () => {
    storage.setItem(STORAGE_KEYS.theme, 'sepia');
    storage.setItem(STORAGE_KEYS.themePack, 'unknown-pack');
    storage.setItem(STORAGE_KEYS.density, 'dense');

    const matchMedia = vi.fn(() => ({ matches: true }));

    const appearance = readStoredAppearance({ storage, matchMedia });
    applyStoredDocumentAppearance({ storage, matchMedia });

    expect(appearance).toEqual({
      theme: 'dark',
      themePack: 'default',
      density: 'comfortable',
    });
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.hasAttribute('data-theme-pack')).toBe(false);
    expect(document.documentElement.hasAttribute('data-density')).toBe(false);
  });

  it('persists explicit choices and removes default-derived keys', () => {
    persistAppearance(
      {
        theme: 'light',
        themePack: 'default',
        density: 'comfortable',
      },
      { storage },
    );

    expect(storage.getItem(STORAGE_KEYS.theme)).toBe('light');
    expect(storage.getItem(STORAGE_KEYS.themePack)).toBeNull();
    expect(storage.getItem(STORAGE_KEYS.density)).toBeNull();

    persistAppearance(
      {
        theme: 'dark',
        themePack: 'warp',
        density: 'compact',
      },
      { storage },
    );

    expect(storage.getItem(STORAGE_KEYS.theme)).toBe('dark');
    expect(storage.getItem(STORAGE_KEYS.themePack)).toBe('warp');
    expect(storage.getItem(STORAGE_KEYS.density)).toBe('compact');
  });
});
