/**
 * Non-`default` theme pack ids that may be stored in `localStorage` / `data-theme-pack`.
 * The only synthetic id we exclude is **`default`** (no `data-theme-pack` attribute).
 *
 * **`linear` belongs in this set** (users can pick it) but is **absent** from
 * `THEME_PACK_WEBFONT_IMPORTERS` on purpose: Linear uses **Inter + JetBrains Mono** from
 * `index.html`, not a Fontsource chunk.
 */
export const THEME_PACK_ALLOWLIST = new Set(['linear', 'vercel', 'cursor', 'warp', 'apple']);

/**
 * Packs that load bundled Fontsource CSS via dynamic `import` (see `styles/fonts-pack-*.css`).
 * Omitted: **`default`**, **`linear`** (index.html webfonts), **`apple`** (system font stack only).
 */
export const THEME_PACK_WEBFONT_IMPORTERS = {
  vercel: () => import('./styles/fonts-pack-vercel.css'),
  cursor: () => import('./styles/fonts-pack-cursor.css'),
  warp: () => import('./styles/fonts-pack-warp.css'),
};
