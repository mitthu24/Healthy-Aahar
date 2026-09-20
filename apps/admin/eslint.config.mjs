import { nextConfig } from '@healthy-aahar/config/eslint/next';

export default [
  ...nextConfig,
  { ignores: ['.next/**', 'next-env.d.ts'] },
];
