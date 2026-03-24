import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import legacy from '@vitejs/plugin-legacy';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    // Emit a legacy SystemJS bundle + polyfills so client-display.html works
    // on VEWD/old TV browsers (Chromium 38–52) when served via LAN casting.
    // Modern Android WebView and real browsers still get the native ES bundle.
    legacy({
      targets: ['chrome >= 50', 'safari >= 12', 'firefox >= 60'],
      additionalLegacyPolyfills: ['regenerator-runtime/runtime'],
    }),
  ],
  resolve: {
    alias: {
      // Allow importing from the shared/ module at the repo root
      '@shared': path.resolve(__dirname, '../shared'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/__tests__/setup.js',
    include: ['src/**/*.test.{js,jsx}'],
    alias: {
      '@shared': path.resolve(__dirname, '../shared'),
    },
  },
  build: {
    commonjsOptions: {
      // The shared/ directory uses CommonJS (module.exports).
      // Tell Rollup's CJS plugin to process files outside node_modules.
      include: [/shared\//, /node_modules\//],
    },
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        'client-display': path.resolve(__dirname, 'client-display.html'),
      },
    },
  },
  optimizeDeps: {
    include: ['@shared/db-adapter', '@shared/scripture-engine'],
    exclude: ['fts5-sql-bundle'],
  },
});
