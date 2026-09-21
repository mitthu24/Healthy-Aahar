import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 180_000,
    // Integration files provision a shared database; running them in
    // parallel causes TRUNCATE contention between files.
    fileParallelism: false,
  },
});
