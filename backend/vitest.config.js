import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'agentboard-backend',
    root: import.meta.dirname,
    environment: 'node',
    include: ['**/*.test.js'],
    testTimeout: 10000,
  },
});
