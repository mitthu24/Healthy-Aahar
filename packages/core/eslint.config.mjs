import { nodeConfig } from '@healthy-aahar/config/eslint/node';

export default [
  ...nodeConfig,
  {
    // The domain layer is pure by contract: no I/O, no framework, no
    // persistence. A violation here is an architecture bug, so it fails CI
    // rather than review (docs/02-SYSTEM-ARCHITECTURE.md §4).
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@healthy-aahar/db', '@prisma/client'], message: 'The domain layer must not depend on persistence.' },
            { group: ['hono', 'next', 'react'], message: 'The domain layer must not depend on a framework.' },
            { group: ['../services/*', '../ports/*'], message: 'Dependencies point downward only.' },
          ],
        },
      ],
    },
  },
];
