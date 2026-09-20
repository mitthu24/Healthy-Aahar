import { clientEnvSchema, parseClientEnv } from '@healthy-aahar/config/env/client';

/**
 * Public configuration for this app.
 *
 * Next.js inlines NEXT_PUBLIC_* at build time, so these must be referenced
 * statically rather than via process.env[key]. Validated here so a missing
 * variable is a build failure, not a blank screen (BR-ENV1).
 */
export const env = parseClientEnv(clientEnvSchema, {
  NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
  NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
  NEXT_PUBLIC_MARKETING_URL: process.env.NEXT_PUBLIC_MARKETING_URL,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_CDN_BASE_URL: process.env.NEXT_PUBLIC_CDN_BASE_URL,
  NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
});
