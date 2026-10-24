/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { pwaOptions } from './src/pwa/pwaOptions';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    // Para GitHub Pages em subpasta: BASE_PATH=/nome-do-repo/ npm run build
    base: env.BASE_PATH || '/',
    plugins: [react(), VitePWA(pwaOptions)],
    define: {
      __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '1.0.0'),
    },
    build: {
      target: 'es2020',
      sourcemap: false,
      chunkSizeWarningLimit: 1500,
      rollupOptions: {
        output: {
          manualChunks: {
            xlsx: ['xlsx'],
            charts: ['recharts'],
          },
        },
      },
    },
    test: {
      environment: 'node',
      setupFiles: ['./tests/setup.ts'],
      include: ['tests/**/*.test.ts'],
      testTimeout: 30000,
    },
  };
});
