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
import { assertLoginNotRateLimited } from '../../middleware/rate-limit.js';
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
  errors: ['INVALID_CREDENTIALS', 'ACCOUNT_SUSPENDED', 'RATE_LIMITED'],
  openapi: {
    tags: ['Auth'],
    request: { body: customerLoginBodySchema },
    responses: {
      200: { description: 'Signed in', schema: customerSessionResponseSchema },
      401: jsonError('Incorrect email or password'),
      403: jsonError('Account suspended'),
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
    const scope = businessScope(c.env.businessId);

    const result = await c.env.services.customerAuth.register(scope, {
      email: body.email,
      password: body.password,
      phone: body.phone,
      firstName: body.first_name,
      lastName: body.last_name,
      sessionTtlMs: c.env.env.CUSTOMER_SESSION_MAX_AGE_SECONDS * 1000,
      ipAddress: c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for'),
      userAgent: c.req.header('user-agent'),
    });

    return c.json(toSessionResponse(result), 201);
  });

  app.post('/login', async (c) => {
    const body = customerLoginBodySchema.parse(await c.req.json());

    const ip = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? 'unknown';
    await assertLoginNotRateLimited(c.env.auth.loginRateLimitStore, {
      enabled: c.env.env.RATE_LIMIT_ENABLED,
      limit: c.env.env.LOGIN_RATE_LIMIT_PER_MIN,
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
