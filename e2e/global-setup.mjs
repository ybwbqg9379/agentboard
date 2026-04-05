import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * `vite preview` needs frontend/dist. Fail fast with a clear message when
 * someone runs `npx playwright test` without `npm run build` / `npm run test:e2e`.
 */
export default function globalSetup() {
  const distIndex = join(root, 'frontend', 'dist', 'index.html');
  if (!existsSync(distIndex)) {
    throw new Error(
      '[playwright] Missing frontend/dist — run `npm run build` first, or use `npm run test:e2e` (build + test).',
    );
  }
}
