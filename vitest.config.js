import { defineConfig } from 'vitest/config';

/** Explicit config paths (not bare `frontend`/`backend` dirs) so tooling resolves each project's `root` and `setupFiles` consistently. */
export default defineConfig({
  test: {
    projects: ['./frontend/vitest.config.js', './backend/vitest.config.js'],
  },
});
