import { adminMeSchema, bearerSessionBodySchema, errorResponseSchema } from '@healthy-aahar/contracts';
import { businessScope, DomainError } from '@healthy-aahar/core';
import { CSRF_COOKIE, CSRF_HEADER, FirebaseConfigurationError, generateCsrfToken, TokenVerificationError } from '@healthy-aahar/auth';
import { Hono } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';

import { registerRoute } from '../../lib/route-registry.js';
import { adminAuth } from '../../middleware/admin-auth.js';
import type { AdminActor } from '@healthy-aahar/core';
import type { AppBindings } from '../../types.js';

const jsonError = (description: string) => ({ description, schema: errorResponseSchema });

const SESSION_COOKIE = '__Host-admin_session';

/**
 * Admin session lifecycle (docs/07 §5). This REPLACES the PHASE 02
 * `ADMIN_DEV_TOKEN` bypass entirely: a real Firebase ID token from the
 * ADMIN project is exchanged for an `HttpOnly`, `__Host-`, `SameSite=Strict`
 * session cookie plus a readable CSRF token (docs/23 §6).
 */

registerRoute({
  method: 'POST',
  path: '/v1/admin/auth/session',
  audience: 'admin',
  authRoute: true,
  summary: 'Exchange a Firebase admin ID token for a session cookie',
  phase: '03',
  errors: ['UNAUTHENTICATED', 'WRONG_AUDIENCE', 'TOKEN_EXPIRED', 'ACCOUNT_SUSPENDED'],
  openapi: {
    tags: ['Admin: Auth'],
    request: { body: bearerSessionBodySchema },
    responses: {
      200: { description: 'Session established', schema: adminMeSchema },
      401: jsonError('Invalid, expired or wrong-audience token, or no admin account exists'),
      403: jsonError('Account suspended or deactivated'),
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

  app.post('/session', async (c) => {
    const body = bearerSessionBodySchema.parse(await c.req.json());

    let identity;
    try {
      identity = await c.env.auth.adminVerifier.verify(body.id_token);
    } catch (error) {
      if (error instanceof TokenVerificationError) {
        const code = error.reason === 'EXPIRED' ? 'TOKEN_EXPIRED' : 'UNAUTHENTICATED';
        throw new DomainError(code, error.message);
      }
      if (error instanceof FirebaseConfigurationError) {
        c.get('logger')?.error({ msg: 'security.firebase_misconfigured', err: error.message }, 'admin Firebase project is not configured');
        throw new DomainError('SERVICE_UNAVAILABLE', 'Admin authentication is temporarily unavailable.');
      }
      throw error;
    }

    const scope = businessScope(c.env.businessId);
    const actor = await c.env.services.adminAuth.resolveActor(scope, identity.uid);

    const maxAgeSeconds = c.env.env.ADMIN_SESSION_MAX_AGE_SECONDS;
    const cookie = await c.env.auth.adminSession.createSessionCookie(body.id_token, maxAgeSeconds * 1000);

    setCookie(c, SESSION_COOKIE, cookie, {
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
      // A logout revokes the underlying Firebase refresh tokens too, not only
      // the local cookie, so the same ID token cannot mint a fresh session
      // cookie elsewhere after the user believes they have signed out.
      const scope = businessScope(c.env.businessId);
      const profile = await c.env.services.adminAuth.getProfile(scope, actor.adminUserId);
      if (profile) await c.env.auth.adminSession.revokeRefreshTokens(profile.firebaseUid);
    }
    // __Host- cookies require secure: true even on deletion — Hono's
    // serializer enforces the prefix's own rules, so an omitted `secure`
    // here throws rather than silently clearing the cookie.
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
