import { getCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';

import { businessScope, DomainError } from '@healthy-aahar/core';

import type { AppBindings } from '../types.js';

const SESSION_COOKIE = '__Host-admin_session';

/** Requests that establish a session rather than use one (docs/07 §5.1). */
const LOGIN_PATH = '/v1/admin/auth/login';

/**
 * Resolves the `__Host-admin_session` cookie to a real `Actor` (docs/07 §5,
 * §6). PHASE 03: the cookie value is an opaque, DB-backed session token —
 * this REPLACES the Firebase session-cookie verification (and, before that,
 * the PHASE 02 `devAdminAuth` bypass) entirely.
 *
 * `users.status` is re-checked on every request (not cached) because a
 * session stays valid for up to `ADMIN_SESSION_MAX_AGE_SECONDS`; suspending
 * an account in our own database must take effect on the very next request
 * (BR-SEC3). Permissions ARE cached (60s, version-invalidated) — see
 * `PermissionCache`. The idle timeout (`ADMIN_SESSION_IDLE_TIMEOUT_SECONDS`)
 * is enforced here for the first time — it was declared but never checked
 * under the PHASE 03 Firebase design.
 */
export const adminAuth = createMiddleware<AppBindings>(async (c, next) => {
  if (c.req.path === LOGIN_PATH) {
    // The login route verifies email + password itself and has no cookie
    // yet — nothing to resolve here.
    await next();
    return;
  }

  const cookie = getCookie(c, SESSION_COOKIE);

  if (!cookie) {
    throw new DomainError('UNAUTHENTICATED', 'No admin session.');
  }

  const idleTimeoutMs = c.env.env.ADMIN_SESSION_IDLE_TIMEOUT_SECONDS * 1000;
  const { userId } = await c.env.services.adminAuth.verifySession(cookie, idleTimeoutMs);

  const scope = businessScope(c.env.businessId);
  const actor = await c.env.services.adminAuth.resolveActor(scope, userId);

  c.set('actor', actor);
  await next();
});
