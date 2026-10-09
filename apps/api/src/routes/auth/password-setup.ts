import { errorResponseSchema, passwordSetupBodySchema } from '@healthy-aahar/contracts';
import { Hono } from 'hono';

import { registerRoute } from '../../lib/route-registry.js';
import { assertAuthRateLimit } from '../../middleware/rate-limit.js';
import type { AppBindings } from '../../types.js';

const jsonError = (description: string) => ({ description, schema: errorResponseSchema });

/**
 * One-time password setup/reset (PHASE 03, docs/07 §5.1).
 *
 * Audience-agnostic by design: the token (not a session) identifies the
 * user, so the SAME endpoint serves a newly invited admin setting their
 * first password and a customer's future self-service "forgot password"
 * flow. Registered under the `customer` audience bucket purely to satisfy
 * the route registry's audience enum (admin | customer); it requires no
 * prior session of either kind and sets no cookie.
 */
registerRoute({
  method: 'POST',
  path: '/v1/auth/password/setup',
  audience: 'customer',
  authRoute: true,
  summary: 'Set a password using a one-time setup/reset token',
  phase: '03',
  errors: ['PASSWORD_SETUP_TOKEN_INVALID', 'WEAK_PASSWORD', 'RATE_LIMITED'],
  openapi: {
    tags: ['Auth'],
    request: { body: passwordSetupBodySchema },
    responses: {
      200: { description: 'Password set' },
      401: jsonError('The token is invalid, expired or already used'),
      422: jsonError('Password does not meet the minimum requirements'),
      429: jsonError('Too many attempts'),
    },
  },
});

export function passwordSetupRoutes(): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.post('/password/setup', async (c) => {
    const body = passwordSetupBodySchema.parse(await c.req.json());

    // IP-only (no email travels in this body — the token itself identifies
    // the account). The token's 256 bits of entropy already make brute
    // forcing it computationally infeasible regardless of any rate limit;
    // this guards against repeated-request resource exhaustion (a DB
    // lookup plus, on a valid token, a full scrypt hash per attempt), the
    // same concern register/login are rate-limited for.
    const ip = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? 'unknown';
    await assertAuthRateLimit(c, c.env.auth.loginRateLimitStore, {
      enabled: c.env.env.RATE_LIMIT_ENABLED,
      limit: c.env.env.REGISTER_RATE_LIMIT_PER_MIN,
      bucket: 'password-setup',
      ip,
    });

    await c.env.services.passwordReset.setPassword({ token: body.token, newPassword: body.password });
    return c.json({ ok: true });
  });

  return app;
}
