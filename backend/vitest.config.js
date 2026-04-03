import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'agentboard-backend',
    root: import.meta.dirname,
    environment: 'node',
    include: ['**/*.test.js'],
    testTimeout: 10000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: './coverage',
      include: ['**/*.js'],
      exclude: ['**/*.test.js', 'vitest.config.js', 'node_modules/**', 'coverage/**'],
    },
  },
});
