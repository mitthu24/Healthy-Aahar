import { timingSafeEqual } from 'node:crypto';

import { createMiddleware } from 'hono/factory';

import type { AppBindings } from '../types.js';

/**
 * PHASE 02 ONLY — development admin authorization.
 *
 * Real admin authentication (Firebase admin project + RBAC) is PHASE 03.
 * Until then the admin configuration endpoints need *some* gate, and
 * pretending authentication exists would be worse than admitting it does not.
 *
 * Three properties make this safe to ship in a non-production environment
 * and impossible to ship to production (ADR-030, acceptance criterion 24):
 *
 *   1. `loadServerEnv()` REFUSES TO BOOT if ADMIN_DEV_TOKEN is set while
 *      APP_ENV=production. The process does not start at all.
 *   2. This middleware additionally refuses at request time if it somehow
 *      finds itself running in production — belt and braces, because the
 *      cost of being wrong here is total.
 *   3. If the token is absent, every admin request is REJECTED. There is no
 *      silent fallback to "allow" — the failure mode is closed, not open.
 *
 * PHASE 03 deletes this file and replaces it with the real verifier.
 */

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');

  // timingSafeEqual throws on length mismatch, which would itself leak
  // length via the exception path. Compare lengths first, then bytes.
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export const devAdminAuth = createMiddleware<AppBindings>(async (c, next) => {
  const env = c.env.env;
  const requestId = c.get('requestId');

  // (2) Never, under any circumstance, in production.
  if (env.APP_ENV === 'production') {
    c.get('logger')?.error(
      { msg: 'security.dev_admin_auth_in_production' },
      'development admin auth reached production — refusing',
    );

    return c.json(
      {
        error: {
          code: 'FORBIDDEN',
          message: 'Admin authentication is not available.',
          request_id: requestId,
        },
      },
      403,
    );
  }

  // (3) No token configured means closed, not open.
  if (!env.ADMIN_DEV_TOKEN) {
    return c.json(
      {
        error: {
          code: 'UNAUTHENTICATED',
          message:
            'Admin access is not configured in this environment. ' +
            'Set ADMIN_DEV_TOKEN (development only) or wait for PHASE 03 authentication.',
          request_id: requestId,
        },
      },
      401,
    );
  }

  const presented = c.req.header('x-dev-admin-token');

  if (!presented || !constantTimeEquals(presented, env.ADMIN_DEV_TOKEN)) {
    c.get('logger')?.warn(
      { msg: 'authz.denied', reason: 'invalid_dev_admin_token' },
      'admin request denied',
    );

    return c.json(
      {
        error: {
          code: 'UNAUTHENTICATED',
          message: 'Invalid or missing admin credentials.',
          request_id: requestId,
        },
      },
      401,
    );
  }

  // A synthetic actor. PHASE 03 replaces this with a real admin resolved
  // from a verified Firebase token, carrying real permissions.
  c.set('actor', {
    kind: 'ADMIN',
    userId: '00000000-0000-7000-8000-000000000000',
    adminUserId: '00000000-0000-7000-8000-000000000000',
    // Deliberately empty: PHASE 02 has no permission model yet, so no route
    // may rely on a permission being present. Routes declare the permission
    // they WILL require, and the registry asserts it, but enforcement lands
    // with RBAC in PHASE 03.
    permissions: new Set<string>(),
    isSuperAdmin: true,
  });

  await next();
  return undefined;
});
