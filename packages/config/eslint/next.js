import { baseConfig } from './base.js';
import globals from 'globals';

export const nextConfig = [
  ...baseConfig,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      // Frontends must never import the database or hold a connection.
      // Only apps/api and apps/worker may talk to PostgreSQL (docs/02 principle 2).
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@healthy-aahar/db',
              message:
                'Frontends must not access the database directly. Call the API via @healthy-aahar/sdk (docs/02-SYSTEM-ARCHITECTURE.md principle 2).',
            },
            {
              name: '@prisma/client',
              message: 'Frontends must not import Prisma. Call the API via @healthy-aahar/sdk.',
            },
          ],
        },
      ],
    },
  },
];

export default nextConfig;
