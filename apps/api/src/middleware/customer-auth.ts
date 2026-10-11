import { createMiddleware } from 'hono/factory';

import { DomainError } from '@healthy-aahar/core';

import type { AppBindings } from '../types.js';

/**
 * Resolves the `Authorization: Bearer <session token>` header to a
 * `CUSTOMER` actor for every `/v1/me/*` route (docs/07 §4, §6, docs/30 §2).
 *
 * PHASE 03: the bearer value is an opaque, DB-backed session token issued by
 * `POST /v1/auth/login` or `POST /v1/auth/register` — this REPLACES Firebase
 * ID-token verification. The customer API deliberately stays bearer-token,
 * cookie-free (docs/30's mobile-readiness claim): a future native client
 * sends the identical header with no API change.
 */
export const customerAuth = createMiddleware<AppBindings>(async (c, next) => {
  const header = c.req.header('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;

  if (!token) {
    throw new DomainError('UNAUTHENTICATED', 'Missing bearer token.');
  }

  const { userId } = await c.env.services.customerAuth.verifySession(token);
  const actor = await c.env.services.customerAuth.resolveActor(userId);
  c.set('actor', actor);
  await next();
});
