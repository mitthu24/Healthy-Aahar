import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Integration tests provision a database and apply migrations, so the
    // first test in a file pays a one-off setup cost.
    testTimeout: 30_000,
    hookTimeout: 180_000,
    // Each file gets its own database connection; running files in parallel
    // against one PostgreSQL causes TRUNCATE contention between them.
    fileParallelism: false,
  },
});
