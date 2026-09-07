import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Dev server proxies `/api` to the backend (F-002, default port 3000) so the
 * browser talks to a single origin and cookies "just work" in development.
 * In staging/production the app is served behind a reverse proxy that routes
 * `/api` to the backend, so the frontend never needs an absolute API URL.
 */
const API_TARGET = process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 4173,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**', 'src/main.tsx', 'src/vite-env.d.ts'],
    },
  },
});
