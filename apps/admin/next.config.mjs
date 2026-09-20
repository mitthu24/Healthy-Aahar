import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const monorepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Without this, Next walks up and finds an unrelated lockfile outside the
  // repo, then traces the wrong file set into the deployment bundle.
  outputFileTracingRoot: monorepoRoot,
  // Workspace packages ship TypeScript source and are compiled by Next.
  transpilePackages: ['@healthy-aahar/ui', '@healthy-aahar/contracts', '@healthy-aahar/config'],
  experimental: {
    optimizePackageImports: ['@healthy-aahar/ui'],
  },
  webpack: (config) => {
    // Workspace packages are published as TypeScript source and use explicit
    // ESM '.js' specifiers (required by Node's ESM resolver for apps/api and
    // apps/worker). Webpack does not apply that mapping by default, so it is
    // declared here rather than dropping the extensions and breaking Node.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
  images: {
    formats: ['image/avif', 'image/webp'],
  },
  async headers() {
    return [
      {
        // This surface must never be indexed. Applied here AND at the
        // Cloudflare edge — a single mechanism is one misconfiguration away
        // from indexing a customer's order page (BR-SEO1).
        source: '/:path*',
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
      },
    ];
  },
};

export default nextConfig;
