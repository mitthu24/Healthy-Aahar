import { adminLoginBodySchema, adminMeSchema, errorResponseSchema } from '@healthy-aahar/contracts';
import { businessScope, DomainError } from '@healthy-aahar/core';
import { CSRF_COOKIE, CSRF_HEADER, generateCsrfToken } from '@healthy-aahar/auth';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';

import { registerRoute } from '../../lib/route-registry.js';
import { assertLoginNotRateLimited } from '../../middleware/rate-limit.js';
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
 * the caller its raw token as an `HttpOnly`, `__Host-`, `SameSite=Strict`
 * cookie, plus a readable CSRF token (docs/23 §6). This REPLACES the
 * Firebase ID-token exchange (and, before that, the PHASE 02
 * `ADMIN_DEV_TOKEN` bypass) entirely.
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
  designation: string | null;
  is_super_admin: boolean;
  permissions: string[];
  roles: string[];
}> {
  const scope = businessScope(c.env.businessId);
  const profile = await c.env.services.adminAuth.getProfile(scope, actor.adminUserId);

  return {
    id: actor.adminUserId,
    user_id: actor.userId,
    full_name: profile?.fullName ?? '',
    email: profile?.email ?? null,
    designation: profile?.designation ?? null,
    is_super_admin: actor.isSuperAdmin,
    permissions: [...actor.permissions],
    roles: profile?.roleKeys ?? [],
  };
}

export function adminAuthRoutes(): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.post('/login', async (c) => {
    const body = adminLoginBodySchema.parse(await c.req.json());

    const ip = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? 'unknown';
    await assertLoginNotRateLimited(c.env.auth.loginRateLimitStore, {
      enabled: c.env.env.RATE_LIMIT_ENABLED,
      limit: c.env.env.LOGIN_RATE_LIMIT_PER_MIN,
      ip,
      email: body.email,
    });

    const scope = businessScope(c.env.businessId);
    const maxAgeSeconds = c.env.env.ADMIN_SESSION_MAX_AGE_SECONDS;

    const { token, actor } = await c.env.services.adminAuth.login(scope, {
      email: body.email,
      password: body.password,
      sessionTtlMs: maxAgeSeconds * 1000,
      ipAddress: ip,
      userAgent: c.req.header('user-agent'),
    });

    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
      path: '/',
      maxAge: maxAgeSeconds,
    });

    const csrfToken = generateCsrfToken(c.env.env.ADMIN_CSRF_SECRET);
    setCookie(c, CSRF_COOKIE, csrfToken, {
      httpOnly: false, // client JS must read this to echo it in the X-CSRF-Token header.
      secure: true,
      sameSite: 'Strict',
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
    deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true, sameSite: 'Strict' });
    deleteCookie(c, CSRF_COOKIE, { path: '/', secure: true, sameSite: 'Strict' });
    return c.json({ signed_out: true });
  });

  app.get('/me', adminAuth, async (c) => {
    const actor = c.get('actor');
    if (actor.kind !== 'ADMIN') throw new DomainError('UNAUTHENTICATED', 'Not authenticated.');
    return c.json(await toMeResponse(c, actor));
  });

  return app;
}
