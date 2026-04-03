import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import legacy from '@vitejs/plugin-legacy'
import { visualizer } from 'rollup-plugin-visualizer'

export default defineConfig({
  plugins: [
    react(),
    legacy({
      // React 19 has no generator usage; regenerator polyfill is dead weight.
      targets: ['chrome >= 50', 'safari >= 12', 'firefox >= 60'],
    }),
    // Bundle visualizer: run with ANALYZE=true npm run build to open stats
    visualizer({ open: process.env.ANALYZE === 'true', filename: 'bundle-stats.html' }),
  ],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/__tests__/setup.js',
    include: ['src/**/*.test.{js,jsx}'],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-socket': ['socket.io-client'],
          'vendor-qrcode': ['qrcode'],
        },
      },
    },
  },
})