import { defineConfig } from 'vitest/config';

/** Component-test setup for this package's primitives — see apps/admin/vitest.config.ts for the original precedent and why each option is needed. */
export default defineConfig({
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
  },
});
