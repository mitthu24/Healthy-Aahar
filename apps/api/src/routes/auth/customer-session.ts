import {
  customerLoginBodySchema,
  customerRegisterBodySchema,
  customerSessionResponseSchema,
  customerWhoAmISchema,
  errorResponseSchema,
} from '@healthy-aahar/contracts';
import { businessScope, DomainError } from '@healthy-aahar/core';
import { Hono } from 'hono';

import { registerRoute } from '../../lib/route-registry.js';
import { assertAuthRateLimit } from '../../middleware/rate-limit.js';
import { customerAuth } from '../../middleware/customer-auth.js';
import type { AppBindings } from '../../types.js';

const jsonError = (description: string) => ({ description, schema: errorResponseSchema });

/**
 * Customer email/password authentication (PHASE 03, docs/07 §4, docs/30 §2).
 *
 * The customer API stays bearer-token, cookie-free by design: `register`
 * and `login` return the raw session token in the response body, and every
 * other customer route (none exist yet — they arrive with the
 * catalogue/cart/order phases) resolves the same `Authorization: Bearer`
 * header a future native client would send unchanged.
 */

registerRoute({
  method: 'POST',
  path: '/v1/auth/register',
  audience: 'customer',
  authRoute: true,
  summary: 'Create a customer account with email + password',
  phase: '03',
  errors: ['EMAIL_ALREADY_REGISTERED', 'WEAK_PASSWORD', 'RATE_LIMITED'],
  openapi: {
    tags: ['Auth'],
    request: { body: customerRegisterBodySchema },
    responses: {
      201: { description: 'Account created and signed in', schema: customerSessionResponseSchema },
      409: jsonError('An account with this email already exists'),
      422: jsonError('Password does not meet the minimum requirements'),
      429: jsonError('Too many attempts'),
    },
  },
});

registerRoute({
  method: 'POST',
  path: '/v1/auth/login',
  audience: 'customer',
  authRoute: true,
  summary: 'Email + password login',
  phase: '03',
  // No ACCOUNT_SUSPENDED here: a suspended account is DELIBERATELY
  // indistinguishable from a wrong password at login (Step 5 — no
  // enumeration), so this route can never actually return it. It IS
  // reachable on GET /v1/auth/me (a session that was valid at login time
  // but belongs to an account suspended since) — that route still declares
  // it. Fix #5: this list used to claim a response this handler could
  // never produce; a client coded against it would wait forever.
  errors: ['INVALID_CREDENTIALS', 'RATE_LIMITED'],
  openapi: {
    tags: ['Auth'],
    request: { body: customerLoginBodySchema },
    responses: {
      200: { description: 'Signed in', schema: customerSessionResponseSchema },
      401: jsonError('Incorrect email or password'),
      429: jsonError('Too many attempts'),
    },
  },
});

registerRoute({
  method: 'POST',
  path: '/v1/auth/logout',
  audience: 'customer',
  authRoute: true,
  summary: 'End the current session',
  phase: '03',
  openapi: {
    tags: ['Auth'],
    responses: { 200: { description: 'Signed out' } },
  },
});

registerRoute({
  method: 'GET',
  path: '/v1/auth/me',
  audience: 'customer',
  authRoute: true,
  summary: 'The authenticated customer',
  phase: '03',
  errors: ['UNAUTHENTICATED', 'ACCOUNT_SUSPENDED'],
  openapi: {
    tags: ['Auth'],
    responses: {
      200: { description: 'Customer identity', schema: customerWhoAmISchema },
      401: jsonError('Not authenticated'),
    },
  },
});

function toSessionResponse(result: { user: { id: string; phone: string | null; email: string | null; status: string }; profile: { id: string; firstName: string | null; lastName: string | null; displayName: string | null }; token: string }) {
  return {
    user: {
      id: result.user.id,
      phone: result.user.phone,
      email: result.user.email,
      status: result.user.status,
    },
    profile: {
      id: result.profile.id,
      first_name: result.profile.firstName,
      last_name: result.profile.lastName,
      display_name: result.profile.displayName,
    },
    token: result.token,
  };
}

export function customerAuthRoutes(): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.post('/register', async (c) => {
    const body = customerRegisterBodySchema.parse(await c.req.json());

    // Fix #1: registration previously had NO rate limiting at all — an
    // unauthenticated caller could force unlimited full-cost scrypt
    // computations and account-creation attempts. Checked BEFORE any
    // lookup or hashing, and before the handler ever learns whether the
    // email is already registered, so the 429 itself reveals nothing about
    // that — same no-enumeration property the login path already has.
    const ip = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? 'unknown';
    await assertAuthRateLimit(c, c.env.auth.loginRateLimitStore, {
      enabled: c.env.env.RATE_LIMIT_ENABLED,
      limit: c.env.env.REGISTER_RATE_LIMIT_PER_MIN,
      bucket: 'customer-register',
      ip,
      email: body.email,
    });

    const scope = businessScope(c.env.businessId);

    const result = await c.env.services.customerAuth.register(scope, {
      email: body.email,
      password: body.password,
      phone: body.phone,
      firstName: body.first_name,
      lastName: body.last_name,
      sessionTtlMs: c.env.env.CUSTOMER_SESSION_MAX_AGE_SECONDS * 1000,
      ipAddress: ip,
      userAgent: c.req.header('user-agent'),
    });

    return c.json(toSessionResponse(result), 201);
  });

  app.post('/login', async (c) => {
    const body = customerLoginBodySchema.parse(await c.req.json());

    const ip = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? 'unknown';
    await assertAuthRateLimit(c, c.env.auth.loginRateLimitStore, {
      enabled: c.env.env.RATE_LIMIT_ENABLED,
      limit: c.env.env.LOGIN_RATE_LIMIT_PER_MIN,
      bucket: 'customer-login',
      ip,
      email: body.email,
    });

    const result = await c.env.services.customerAuth.login({
      email: body.email,
      password: body.password,
      sessionTtlMs: c.env.env.CUSTOMER_SESSION_MAX_AGE_SECONDS * 1000,
      ipAddress: ip,
      userAgent: c.req.header('user-agent'),
    });

    return c.json(toSessionResponse(result), 200);
  });

  app.post('/logout', customerAuth, async (c) => {
    const header = c.req.header('authorization');
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
    if (token) await c.env.services.customerAuth.logout(token);
    return c.json({ signed_out: true });
  });

  app.get('/me', customerAuth, async (c) => {
    const actor = c.get('actor');
    if (actor.kind !== 'CUSTOMER') throw new DomainError('UNAUTHENTICATED', 'Not authenticated.');

    return c.json({
      user_id: actor.userId,
      customer_profile_id: actor.customerProfileId,
    });
  });

  return app;
}
