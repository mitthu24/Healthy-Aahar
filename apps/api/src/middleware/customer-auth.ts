import { createMiddleware } from 'hono/factory';

import { DomainError } from '@healthy-aahar/core';
import { FirebaseConfigurationError, TokenVerificationError } from '@healthy-aahar/auth';

import type { AppBindings } from '../types.js';

/**
 * Resolves the `Authorization: Bearer <id token>` header to a `CUSTOMER`
 * actor for every `/v1/me/*` route (docs/07 §4.3, §6). `/v1/auth/session` is
 * the only route that may CREATE a user, so it verifies the bearer token
 * itself and does not use this middleware — every other customer route
 * rejects with 401 if no `users` row exists yet (docs/07 §6 step 4).
 */
export const customerAuth = createMiddleware<AppBindings>(async (c, next) => {
  const header = c.req.header('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;

  if (!token) {
    throw new DomainError('UNAUTHENTICATED', 'Missing bearer token.');
  }

  try {
    const identity = await c.env.auth.customerVerifier.verify(token);
    const actor = await c.env.services.customerAuth.resolveActor(identity.uid);
    c.set('actor', actor);
    await next();
  } catch (error) {
    if (error instanceof TokenVerificationError) {
      const code = error.reason === 'EXPIRED' ? 'TOKEN_EXPIRED' : 'UNAUTHENTICATED';
      throw new DomainError(code, error.message);
    }
    if (error instanceof FirebaseConfigurationError) {
      c.get('logger')?.error({ msg: 'security.firebase_misconfigured', err: error.message }, 'customer Firebase project is not configured');
      throw new DomainError('SERVICE_UNAVAILABLE', 'Sign-in is temporarily unavailable.');
    }
    throw error;
  }
});
