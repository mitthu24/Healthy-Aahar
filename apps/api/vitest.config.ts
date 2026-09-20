import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Integration tests against a real database land in PHASE 02; PHASE 01
    // covers the app wiring, route registry and health endpoints.
    testTimeout: 15_000,
  },
});
