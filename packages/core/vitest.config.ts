import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/domain/**/*.ts'],
      // The domain layer is cheap to test and catastrophic to get wrong,
      // so it carries the strictest gate in the repo (docs/24 §2.2).
      thresholds: { branches: 90, functions: 90, lines: 90, statements: 90 },
    },
  },
});
