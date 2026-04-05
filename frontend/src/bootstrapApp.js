import { preloadStoredThemePackFonts } from './themeFontLoader.js';
import { applyStoredDocumentAppearance } from './themePreferences.js';

function ignorePreloadFailure() {
  /* Font chunk failure should not block the app */
}

export function bootstrapApp({
  applyAppearance = applyStoredDocumentAppearance,
  preloadFonts = preloadStoredThemePackFonts,
  mountRoot,
}) {
  applyAppearance();

  try {
    Promise.resolve(preloadFonts()).catch(ignorePreloadFailure);
  } catch {
    ignorePreloadFailure();
  }

  mountRoot();
}
