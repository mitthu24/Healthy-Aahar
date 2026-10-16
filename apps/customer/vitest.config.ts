import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/**
 * First component-test setup in this app (session-persistence fix —
 * mirrors `apps/admin/vitest.config.ts`, the only prior precedent in this
 * monorepo's frontends for testing client components with jsdom).
 */
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    dedupe: ['react', 'react-dom'],
  },
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
  },
});
