import path from 'path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    exclude: ['**/node_modules/**', '**/tests/e2e/**'],
    // Integration tests start a real (in-memory) PostgreSQL; give them room.
    testTimeout: 30_000,
    hookTimeout: 120_000,
    server: {
      deps: {
        // next-auth imports "next/server" without the .js extension, which plain
        // Node ESM cannot resolve; let Vite do it.
        inline: [/next-auth/, /@auth\/core/],
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
});
