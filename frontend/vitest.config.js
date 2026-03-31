import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{js,jsx}'],
    testTimeout: 10000,
    globals: true,
    setupFiles: ['./src/test-setup.js'],
  },
});
