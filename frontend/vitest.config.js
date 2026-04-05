import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAppVersionDefine } from './vite.version-define.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, '../shared'),
    },
  },
  define: {
    ...getAppVersionDefine(),
  },
  test: {
    name: 'agentboard-frontend',
    root: __dirname,
    environment: 'jsdom',
    include: ['src/**/*.test.{js,jsx}'],
    testTimeout: 10000,
    globals: true,
    // Use absolute path so setupFiles resolves correctly when vitest is
    // invoked from the repo root via the `projects` configuration.
    setupFiles: [resolve(__dirname, 'src/test-setup.js')],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: './coverage',
      include: ['src/**/*.{js,jsx}'],
      exclude: ['src/**/*.test.{js,jsx}', 'src/test-setup.js', 'node_modules/**', 'coverage/**'],
    },
  },
});
