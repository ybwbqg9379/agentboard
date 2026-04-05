import { THEME_PACK_ALLOWLIST } from './themePackConstants.js';

export const STORAGE_KEYS = {
  theme: 'agentboard-theme',
  themePack: 'agentboard-theme-pack',
  density: 'agentboard-density',
  /** Pro console vs Agent-focused user shell (Agent mode only). */
  uiShell: 'agentboard-ui-shell',
};

function getStorage(storage) {
  if (storage) return storage;
  if (typeof window !== 'undefined') return window.localStorage;
  return null;
}

function readStorageValue(key, storage) {
  try {
    return getStorage(storage)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeStorageValue(key, value, storage) {
  try {
    const target = getStorage(storage);
    if (!target) return;
    if (value == null) {
      target.removeItem(key);
      return;
    }
    target.setItem(key, value);
  } catch {
    /* ignore storage failures */
  }
}

function prefersDarkMode(matchMedia) {
  const readMatchMedia =
    matchMedia ?? (typeof window !== 'undefined' ? window.matchMedia.bind(window) : null);
  if (typeof readMatchMedia !== 'function') return false;
  try {
    return readMatchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

export function readStoredTheme({ storage, matchMedia } = {}) {
  const stored = readStorageValue(STORAGE_KEYS.theme, storage);
  if (stored === 'light' || stored === 'dark') return stored;
  return prefersDarkMode(matchMedia) ? 'dark' : 'light';
}

export function readStoredThemePack({ storage } = {}) {
  const stored = readStorageValue(STORAGE_KEYS.themePack, storage);
  return THEME_PACK_ALLOWLIST.has(stored) ? stored : 'default';
}

export function readStoredDensity({ storage } = {}) {
  return readStorageValue(STORAGE_KEYS.density, storage) === 'compact' ? 'compact' : 'comfortable';
}

/** @returns {'pro' | 'agent'} */
export function readStoredUiShell({ storage } = {}) {
  return readStorageValue(STORAGE_KEYS.uiShell, storage) === 'agent' ? 'agent' : 'pro';
}

export function readStoredAppearance(options = {}) {
  return {
    theme: readStoredTheme(options),
    themePack: readStoredThemePack(options),
    density: readStoredDensity(options),
    uiShell: readStoredUiShell(options),
  };
}

export function applyDocumentAppearance(
  { theme, themePack, density, uiShell },
  root = typeof document !== 'undefined' ? document.documentElement : null,
) {
  if (!root) return;
  root.setAttribute('data-theme', theme === 'dark' ? 'dark' : 'light');

  if (themePack && themePack !== 'default') {
    root.setAttribute('data-theme-pack', themePack);
  } else {
    root.removeAttribute('data-theme-pack');
  }

  if (density === 'compact') {
    root.setAttribute('data-density', 'compact');
  } else {
    root.removeAttribute('data-density');
  }

  /* Persisted shell preference; CSS may scope tweaks under html[data-ui-shell='agent']. */
  if ((uiShell ?? 'pro') === 'agent') {
    root.setAttribute('data-ui-shell', 'agent');
  } else {
    root.removeAttribute('data-ui-shell');
  }
}

export function persistAppearance({ theme, themePack, density, uiShell }, { storage } = {}) {
  writeStorageValue(STORAGE_KEYS.theme, theme === 'dark' ? 'dark' : 'light', storage);
  writeStorageValue(
    STORAGE_KEYS.themePack,
    themePack && themePack !== 'default' ? themePack : null,
    storage,
  );
  writeStorageValue(STORAGE_KEYS.density, density === 'compact' ? 'compact' : null, storage);
  writeStorageValue(STORAGE_KEYS.uiShell, (uiShell ?? 'pro') === 'agent' ? 'agent' : null, storage);
}

export function applyStoredDocumentAppearance(options = {}) {
  const appearance = readStoredAppearance(options);
  applyDocumentAppearance(appearance, options.root);
  return appearance;
}
