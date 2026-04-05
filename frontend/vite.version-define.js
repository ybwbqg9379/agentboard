/**
 * Single source for Vite `define.__APP_VERSION__` (repo root package.json).
 * Used by both `vite.config.js` and `vitest.config.js` so dev/build/tests match.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendDir = dirname(fileURLToPath(import.meta.url));

export function getAppVersionDefine() {
  const rootPkg = JSON.parse(readFileSync(resolve(frontendDir, '..', 'package.json'), 'utf-8'));
  return {
    __APP_VERSION__: JSON.stringify(rootPkg.version ?? '0.0.0'),
  };
}
