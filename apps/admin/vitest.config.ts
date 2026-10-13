import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/**
 * First component-test setup in this app (PHASE 04 hotfix — `AuthGate`
 * regression coverage). `jsdom` is required for React Testing Library;
 * nothing else in this monorepo's frontends needed a DOM environment
 * before this, hence no prior precedent to follow here.
 */
export default defineConfig({
  // Vitest's own resolver doesn't read tsconfig's `paths` the way Next's
  // build does — `@/*` has to be declared again here, or every `@/...`
  // import in a tested file fails to resolve.
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    // pnpm's strict, non-hoisted node_modules can otherwise resolve two
    // separate copies of react/react-dom (one for this app, one nested
    // under @testing-library/react's own dependency tree), which React 19
    // refuses to render across ("A React Element from an older version of
    // React was rendered").
    dedupe: ['react', 'react-dom'],
  },
  // Next's own SWC build is configured for the automatic JSX runtime (no
  // `import React` needed per file); Vite's default esbuild JSX transform
  // is the classic one and fails with "React is not defined" without this.
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    // Required for React Testing Library's automatic per-test DOM cleanup
    // (it registers via the global `afterEach`) — without it, each
    // `render()` call across multiple `it()`s in one file accumulates
    // DOM nodes from every prior test in the file.
    globals: true,
  },
});
