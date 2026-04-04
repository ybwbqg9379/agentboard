import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootPkg = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf-8'));

export default defineConfig(({ mode }) => {
  // Load env file based on `mode` from the project root instead of frontend directory
  const env = loadEnv(mode, resolve(__dirname, '..'), '');
  const backendPort = env.PORT || '3001';

  return {
    plugins: [react()],
    define: {
      __APP_VERSION__: JSON.stringify(rootPkg.version),
    },
    server: {
      port: 5173,
      proxy: {
        '/api': `http://localhost:${backendPort}`,
        '/ws': {
          target: `ws://localhost:${backendPort}`,
          ws: true,
        },
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules')) {
              // Only isolate Mermaid and its large drawing deps
              if (id.includes('mermaid') || id.includes('d3') || id.includes('dagre')) {
                return 'visualizer';
              }
              // Isolate React core
              if (id.includes('react') || id.includes('react-dom')) {
                return 'vendor-react';
              }
              // Isolate Markdown engine
              if (
                id.includes('react-markdown') ||
                id.includes('remark') ||
                id.includes('micromark') ||
                id.includes('unist')
              ) {
                return 'vendor-markdown';
              }
              // No fallback return here to avoid circular dependencies in Rollup
            }
          },
        },
      },
      chunkSizeWarningLimit: 1500, // Reduced from 3000 to catch regressions while allowing for larger specialized chunks
    },
  };
});
