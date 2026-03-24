import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import legacy from '@vitejs/plugin-legacy'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // Generate a legacy bundle (SystemJS + polyfills) so that the Client
    // display page works on VEWD / old TV browsers (Chromium 38–52).
    // Modern browsers still get the native ES-module bundle.
    legacy({
      targets: ['chrome >= 50', 'safari >= 12', 'firefox >= 60'],
      additionalLegacyPolyfills: ['regenerator-runtime/runtime'],
    }),
  ],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/__tests__/setup.js',
    include: ['src/**/*.test.{js,jsx}'],
  },
})
