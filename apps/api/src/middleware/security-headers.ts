import { createMiddleware } from 'hono/factory';

import type { AppBindings } from '../types.js';

/**
 * Security headers for API responses (docs/23-SECURITY-ARCHITECTURE.md §6).
 *
 * The API returns JSON, never HTML, so the CSP here is maximally restrictive:
 * nothing should ever be loaded or framed from an API response.
 */
export const securityHeaders = createMiddleware<AppBindings>(async (c, next) => {
  await next();

  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header(
    'Content-Security-Policy',
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  );
  c.header('Cross-Origin-Resource-Policy', 'same-site');
  // The API must never be indexed (BR-SEO1).
  c.header('X-Robots-Tag', 'noindex, nofollow');
  c.header('Permissions-Policy', 'geolocation=(), camera=(), microphone=(), payment=()');
});
