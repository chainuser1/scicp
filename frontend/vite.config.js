import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import legacy from '@vitejs/plugin-legacy'
import { visualizer } from 'rollup-plugin-visualizer'

export default defineConfig({
  plugins: [
    react(),
    legacy({
      targets: ['chrome >= 50', 'safari >= 12', 'firefox >= 60'],
      additionalLegacyPolyfills: ['regenerator-runtime/runtime'],
    }),
    visualizer({ open: true, filename: 'bundle-stats.html' }),
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