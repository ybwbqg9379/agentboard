/**
 * Single source for Vite `define.__APP_VERSION__` (repo root package.json).
 * Used by both `vite.config.js` and `vitest.config.js` so dev/build/tests match.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendDir = dirname(fileURLToPath(import.meta.url));

export function getAppVersionDefine() {
  let version = '0.0.0';
  try {
    const raw = readFileSync(resolve(frontendDir, '..', 'package.json'), 'utf-8');
    const rootPkg = JSON.parse(raw);
    if (rootPkg && typeof rootPkg.version === 'string' && rootPkg.version.trim()) {
      version = rootPkg.version.trim();
    }
  } catch (err) {
    console.warn(
      '[vite.version-define] Could not read root package.json version; using fallback.',
      err instanceof Error ? err.message : err,
    );
  }
  return {
    __APP_VERSION__: JSON.stringify(version),
  };
}
