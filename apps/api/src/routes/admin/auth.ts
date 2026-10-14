import {
  adminLoginBodySchema,
  adminMeSchema,
  changeOwnPasswordBodySchema,
  errorResponseSchema,
} from '@healthy-aahar/contracts';
import { businessScope, DomainError } from '@healthy-aahar/core';
import { CSRF_COOKIE, CSRF_HEADER, generateCsrfToken } from '@healthy-aahar/auth';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';

import { registerRoute } from '../../lib/route-registry.js';
import { assertAuthRateLimit } from '../../middleware/rate-limit.js';
import { adminAuth } from '../../middleware/admin-auth.js';
import type { AdminActor } from '@healthy-aahar/core';
import type { AppBindings } from '../../types.js';

const jsonError = (description: string) => ({ description, schema: errorResponseSchema });

const SESSION_COOKIE = '__Host-admin_session';

/**
 * Admin session lifecycle (docs/07 §5, PHASE 03 — email/password).
 *
 * Email + password is verified against `users.password_hash` (scrypt); a
 * successful login mints a DB-backed session (`sessions` table) and hands
 * the caller its raw token as an `HttpOnly`, `__Host-`, `SameSite=None`
 * cookie, plus a readable CSRF token (docs/23 §6). This REPLACES the
 * Firebase ID-token exchange (and, before that, the PHASE 02
 * `ADMIN_DEV_TOKEN` bypass) entirely.
 *
 * `SameSite=None` (not `Strict`): the admin app and this API are deployed
 * on unrelated base domains (e.g. a Vercel project vs a Railway service),
 * so every request from the admin app to this API is cross-site from the
 * browser's point of view. `SameSite=Strict` silently drops the cookie on
 * every one of those requests — the cookie gets SET on login but is never
 * SENT back, so the admin immediately appears unauthenticated again. CSRF
 * risk from relaxing this is independently covered by the `X-CSRF-Token`
 * double-submit cookie below, which `SameSite` was never the only defense
 * for. `secure: true` (required for `None`, and already set) still blocks
 * the cookie over plain HTTP.
 */

registerRoute({
  method: 'POST',
  path: '/v1/admin/auth/login',
  audience: 'admin',
  authRoute: true,
  summary: 'Email + password login, establishing a session cookie',
  phase: '03',
  errors: ['INVALID_CREDENTIALS', 'RATE_LIMITED'],
  openapi: {
    tags: ['Admin: Auth'],
    request: { body: adminLoginBodySchema },
    responses: {
      200: { description: 'Session established', schema: adminMeSchema },
      401: jsonError('Incorrect email or password'),
      429: jsonError('Too many login attempts'),
    },
  },
});

registerRoute({
  method: 'POST',
  path: '/v1/admin/auth/logout',
  audience: 'admin',
  authRoute: true,
  summary: 'End the admin session',
  phase: '03',
  openapi: {
    tags: ['Admin: Auth'],
    responses: { 200: { description: 'Signed out' } },
  },
});

registerRoute({
  method: 'GET',
  path: '/v1/admin/auth/me',
  audience: 'admin',
  authRoute: true,
  summary: 'The authenticated admin, their roles and effective permissions',
  phase: '03',
  errors: ['UNAUTHENTICATED'],
  openapi: {
    tags: ['Admin: Auth'],
    responses: {
      200: { description: 'Admin identity', schema: adminMeSchema },
      401: jsonError('Not authenticated'),
    },
  },
});

async function toMeResponse(
  c: { env: AppBindings['Bindings'] },
  actor: AdminActor,
): Promise<{
  id: string;
  user_id: string;
  full_name: string;
  email: string | null;
  login_id: string | null;
  designation: string | null;
  is_super_admin: boolean;
  permissions: string[];
  roles: string[];
  must_change_password: boolean;
}> {
  const scope = businessScope(c.env.businessId);
  const profile = await c.env.services.adminAuth.getProfile(scope, actor.adminUserId);

  return {
    id: actor.adminUserId,
    user_id: actor.userId,
    full_name: profile?.fullName ?? '',
    email: profile?.email ?? null,
    login_id: profile?.loginId ?? null,
    designation: profile?.designation ?? null,
    is_super_admin: actor.isSuperAdmin,
    permissions: [...actor.permissions],
    roles: profile?.roleKeys ?? [],
    // Same value the admin-auth middleware already gated this request on —
    // read from the actor rather than re-derived from `profile`, so the two
    // can never disagree.
    must_change_password: actor.mustChangePassword,
  };
}

registerRoute({
  method: 'POST',
  path: '/v1/admin/auth/change-password',
  audience: 'admin',
  authRoute: true,
  summary: 'Change my own password (requires the current password)',
  phase: '04',
  errors: ['INVALID_CREDENTIALS', 'WEAK_PASSWORD'],
  openapi: {
    description:
      'Self-service, for an already-authenticated admin — distinct from ' +
      'POST /v1/admin/admin-users/{id}/reset-password, which issues a ' +
      'token for a DIFFERENT admin to redeem. Revokes every other session.',
    tags: ['Admin: Auth'],
    request: { body: changeOwnPasswordBodySchema },
    responses: {
      200: { description: 'Password changed', schema: adminMeSchema },
      401: jsonError('Current password is incorrect'),
      422: jsonError('New password does not meet the minimum requirements'),
    },
  },
});

export function adminAuthRoutes(): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.post('/login', async (c) => {
    const body = adminLoginBodySchema.parse(await c.req.json());

    const ip = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? 'unknown';
    await assertAuthRateLimit(c, c.env.auth.loginRateLimitStore, {
      enabled: c.env.env.RATE_LIMIT_ENABLED,
      limit: c.env.env.LOGIN_RATE_LIMIT_PER_MIN,
      bucket: 'admin-login',
      ip,
      // STAGE C: the bucketing key is an opaque per-account string, equally
      // valid whether the caller typed an email or a login ID.
      email: body.email,
    });

    const scope = businessScope(c.env.businessId);
    const maxAgeSeconds = c.env.env.ADMIN_SESSION_MAX_AGE_SECONDS;

    const { token, actor } = await c.env.services.adminAuth.login(scope, {
      identifier: body.email,
      password: body.password,
      sessionTtlMs: maxAgeSeconds * 1000,
      ipAddress: ip,
      userAgent: c.req.header('user-agent'),
    });

    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      secure: true,
      sameSite: 'None',
      path: '/',
      maxAge: maxAgeSeconds,
    });

    const csrfToken = generateCsrfToken(c.env.env.ADMIN_CSRF_SECRET);
    setCookie(c, CSRF_COOKIE, csrfToken, {
      httpOnly: false, // client JS must read this to echo it in the X-CSRF-Token header.
      secure: true,
      sameSite: 'None',
      path: '/',
      maxAge: maxAgeSeconds,
    });
    c.header(CSRF_HEADER, csrfToken);

    return c.json(await toMeResponse(c, actor));
  });

  app.post('/logout', adminAuth, async (c) => {
    const actor = c.get('actor');
    if (actor.kind === 'ADMIN') {
      const cookie = getCookie(c, SESSION_COOKIE);
      if (cookie) await c.env.services.adminAuth.logout(cookie);
    }
    // __Host- cookies require secure: true even on deletion — Hono's
    // serializer enforces the prefix's own rules, so an omitted `secure`
    // here throws rather than silently clearing the cookie (ADR-036).
    deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true, sameSite: 'None' });
    deleteCookie(c, CSRF_COOKIE, { path: '/', secure: true, sameSite: 'None' });
    return c.json({ signed_out: true });
  });

  app.get('/me', adminAuth, async (c) => {
    const actor = c.get('actor');
    if (actor.kind !== 'ADMIN') throw new DomainError('UNAUTHENTICATED', 'Not authenticated.');
    return c.json(await toMeResponse(c, actor));
  });

  app.post('/change-password', adminAuth, async (c) => {
    const actor = c.get('actor');
    if (actor.kind !== 'ADMIN') throw new DomainError('UNAUTHENTICATED', 'Not authenticated.');

    const body = changeOwnPasswordBodySchema.parse(await c.req.json());
    const scope = businessScope(c.env.businessId);

    await c.env.services.adminAuth.changeOwnPassword(scope, {
      userId: actor.userId,
      adminUserId: actor.adminUserId,
      currentPassword: body.current_password,
      newPassword: body.new_password,
    });

    // The session this request used was just revoked along with every
    // other one — clear the cookie rather than leaving a dead one behind.
    deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true, sameSite: 'None' });
    deleteCookie(c, CSRF_COOKIE, { path: '/', secure: true, sameSite: 'None' });

    return c.json({ changed: true });
  });

  return app;
}
