import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5174 },
  define: {
    'import.meta.env.VITE_APP_MODE': JSON.stringify(process.env.VITE_APP_MODE || 'presenter'),
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test-setup.js',
  },
});
