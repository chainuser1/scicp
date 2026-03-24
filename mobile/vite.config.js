import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import legacy from '@vitejs/plugin-legacy';
import path from 'path';
import { visualizer } from 'rollup-plugin-visualizer';

export default defineConfig({
  plugins: [
    react(),
    visualizer({ open: true, filename: 'bundle-stats.html' }),
    legacy({
      targets: ['chrome >= 50', 'safari >= 12', 'firefox >= 60'],
      additionalLegacyPolyfills: ['regenerator-runtime/runtime'],
    }),
  ],
  resolve: {
    alias: {
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
      include: [/shared\//, /node_modules\//],
    },
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        'client-display': path.resolve(__dirname, 'client-display.html'),
      },
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-socket': ['socket.io-client'],
          'vendor-qrcode': ['qrcode'],
        },
      },
    },
  },
  optimizeDeps: {
    include: ['@shared/db-adapter', '@shared/scripture-engine'],
    exclude: ['fts5-sql-bundle'],
  },
});