import { THEME_PACK_WEBFONT_IMPORTERS } from './themePackConstants.js';
import { readStoredThemePack } from './themePreferences.js';

/**
 * Loads Fontsource CSS for the given pack if needed. Safe to call multiple times (Vite dedupes the chunk).
 * @param {string} pack  `default` | `linear` | `vercel` | `cursor` | `warp` | `apple`
 */
export function ensureThemePackFontsLoaded(pack) {
  const loader = THEME_PACK_WEBFONT_IMPORTERS[pack];
  if (!loader) return Promise.resolve();
  return loader();
}

/** Preload fonts for the pack already in localStorage before first paint (reduces FOUT on cold load). */
export function preloadStoredThemePackFonts() {
  return ensureThemePackFontsLoaded(readStoredThemePack());
}
