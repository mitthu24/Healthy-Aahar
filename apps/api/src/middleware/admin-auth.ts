import { getCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';

import { businessScope, DomainError } from '@healthy-aahar/core';
import { FirebaseConfigurationError, TokenVerificationError } from '@healthy-aahar/auth';

import type { AppBindings } from '../types.js';

const SESSION_COOKIE = '__Host-admin_session';

/** Requests that establish a session rather than use one (docs/07 §5.1). */
const LOGIN_PATH = '/v1/admin/auth/session';

/**
 * Resolves the `__Host-admin_session` cookie to a real `Actor` (docs/07 §5,
 * §6). This REPLACES the PHASE 02 `devAdminAuth` bypass — every admin
 * request now goes through Firebase session-cookie verification, the
 * `users.status` check, and effective-permission resolution.
 *
 * `users.status` is re-checked on every request (not cached) because a
 * session cookie stays cryptographically valid for up to
 * `ADMIN_SESSION_MAX_AGE_SECONDS`; suspending an account in our own database
 * must take effect on the very next request (BR-SEC3). Permissions ARE
 * cached (60s, version-invalidated) — see `PermissionCache`.
 */
export const adminAuth = createMiddleware<AppBindings>(async (c, next) => {
  if (c.req.path === LOGIN_PATH) {
    // The login route verifies a fresh bearer ID token itself and has no
    // cookie yet — nothing to resolve here.
    await next();
    return;
  }

  const cookie = getCookie(c, SESSION_COOKIE);

  if (!cookie) {
    throw new DomainError('UNAUTHENTICATED', 'No admin session.');
  }

  try {
    const identity = await c.env.auth.adminSession.verifySessionCookie(cookie);

    // Absolute session lifetime (docs/07 §5.2). Idle timeout is enforced at
    // the route layer against `last_activity_at` so it can be updated
    // per-request without a DB write in this hot path for every route.
    const ageSeconds = Date.now() / 1000 - identity.authTime;
    if (ageSeconds > c.env.env.ADMIN_SESSION_MAX_AGE_SECONDS) {
      throw new DomainError('SESSION_EXPIRED', 'Session has expired. Sign in again.');
    }

    const scope = businessScope(c.env.businessId);
    const actor = await c.env.services.adminAuth.resolveActor(scope, identity.uid);

    c.set('actor', actor);
    await next();
  } catch (error) {
    if (error instanceof TokenVerificationError) {
      const code = error.reason === 'EXPIRED' || error.reason === 'REVOKED' ? 'SESSION_EXPIRED' : 'UNAUTHENTICATED';
      throw new DomainError(code, error.message);
    }
    if (error instanceof FirebaseConfigurationError) {
      c.get('logger')?.error({ msg: 'security.firebase_misconfigured', err: error.message }, 'admin Firebase project is not configured');
      throw new DomainError('SERVICE_UNAVAILABLE', 'Admin authentication is temporarily unavailable.');
    }
    throw error;
  }
});
