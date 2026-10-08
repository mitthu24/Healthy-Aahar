import {
  bearerSessionBodySchema,
  customerSessionResponseSchema,
  customerWhoAmISchema,
  errorResponseSchema,
} from '@healthy-aahar/contracts';
import { businessScope, DomainError } from '@healthy-aahar/core';
import { FirebaseConfigurationError, TokenVerificationError } from '@healthy-aahar/auth';
import { Hono } from 'hono';

import { registerRoute } from '../../lib/route-registry.js';
import { customerAuth } from '../../middleware/customer-auth.js';
import type { AppBindings } from '../../types.js';

const jsonError = (description: string) => ({ description, schema: errorResponseSchema });

/**
 * Customer session exchange (docs/07 §4.2).
 *
 * `POST /v1/auth/session` is the ONLY route that may create a `users` row
 * for a customer. Every other customer route (none exist before the
 * catalogue/cart/order phases) resolves an existing user via `customerAuth`
 * and rejects with 401 if none exists yet.
 */

registerRoute({
  method: 'POST',
  path: '/v1/auth/session',
  audience: 'customer',
  authRoute: true,
  summary: 'Exchange a Firebase customer ID token for a provisioned user (creates on first sign-in)',
  phase: '03',
  errors: ['UNAUTHENTICATED', 'WRONG_AUDIENCE', 'TOKEN_EXPIRED', 'ACCOUNT_SUSPENDED'],
  openapi: {
    tags: ['Auth'],
    request: { body: bearerSessionBodySchema },
    responses: {
      200: { description: 'Returning customer', schema: customerSessionResponseSchema },
      201: { description: 'First sign-in — user provisioned', schema: customerSessionResponseSchema },
      401: jsonError('Invalid, expired or wrong-audience token'),
      403: jsonError('Account suspended'),
    },
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

export function customerAuthRoutes(): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.post('/session', async (c) => {
    const body = bearerSessionBodySchema.parse(await c.req.json());

    let identity;
    try {
      identity = await c.env.auth.customerVerifier.verify(body.id_token);
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

    const scope = businessScope(c.env.businessId);
    const result = await c.env.services.customerAuth.createOrResumeSession(scope, {
      firebaseUid: identity.uid,
      phoneNumber: identity.phoneNumber,
      email: identity.email,
    });

    return c.json(
      {
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
      },
      result.created ? 201 : 200,
    );
  });

  app.get('/me', customerAuth, async (c) => {
    const actor = c.get('actor');
    if (actor.kind !== 'CUSTOMER') throw new DomainError('UNAUTHENTICATED', 'Not authenticated.');

    // customerAuth already resolved and validated the actor; re-reading here
    // keeps the response shape identical to POST /session without a second
    // round trip through the service for fields customerAuth didn't need.
    const scope = businessScope(c.env.businessId);
    void scope;
    return c.json({
      user_id: actor.userId,
      customer_profile_id: actor.customerProfileId,
    });
  });

  return app;
}
