import { createHash } from 'node:crypto';

import { newId, now } from '@healthy-aahar/core';
import { Prisma } from '@healthy-aahar/db';
import { createMiddleware } from 'hono/factory';

import type { AppBindings } from '../types.js';

/**
 * Idempotency.
 *
 * PHASE 00 requires this for order and subscription creation (BR-K7), which
 * are PHASE 07 and PHASE 09. The reusable foundation is built here so those
 * phases inherit it rather than each inventing their own.
 *
 * Three behaviours, and the third is the one that matters:
 *
 *   - Same key, same body, completed  -> replay the stored response.
 *   - Same key, still in flight       -> 409, retry shortly.
 *   - Same key, DIFFERENT body        -> 422. Never silently serve the first
 *     response for a different request: a silent wrong answer is worse than
 *     an error (docs/04 §7.6).
 *
 * The unique index on (user_id, endpoint, key) is the mutex. Two concurrent
 * requests race to INSERT; exactly one wins, and the loser is told to retry.
 * No application lock is involved, so this holds across processes.
 */

const IDEMPOTENCY_WINDOW_HOURS = 24;

/** SHA-256 of the canonical body, so key reuse with a changed payload is detectable. */
function hashBody(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export type IdempotencyOptions = {
  /** Reject the request when the header is absent. */
  required: boolean;
};

export function idempotency(options: IdempotencyOptions) {
  return createMiddleware<AppBindings>(async (c, next) => {
    const key = c.req.header('idempotency-key');
    const requestId = c.get('requestId');
    const actor = c.get('actor');

    if (!key) {
      if (!options.required) return next();

      return c.json(
        {
          error: {
            code: 'VALIDATION_FAILED',
            message: 'This operation requires an Idempotency-Key header.',
            details: [{ field: 'Idempotency-Key', issue: 'Header is required' }],
            request_id: requestId,
          },
        },
        422,
      );
    }

    // Keys are scoped per user so they cannot collide across accounts.
    const userId = actor && actor.kind !== 'ANONYMOUS' && 'userId' in actor ? actor.userId : null;

    if (!userId) {
      return c.json(
        {
          error: {
            code: 'UNAUTHENTICATED',
            message: 'Idempotent operations require an authenticated caller.',
            request_id: requestId,
          },
        },
        401,
      );
    }

    const prisma = c.env.prisma;
    const endpoint = `${c.req.method} ${c.req.routePath}`;
    const rawBody = await c.req.raw.clone().text();
    const requestHash = hashBody(rawBody);

    const existing = await prisma.idempotencyKey.findUnique({
      where: { userId_endpoint_key: { userId, endpoint, key } },
    });

    if (existing) {
      // Reusing a key with a different payload is always a client bug.
      if (existing.requestHash !== requestHash) {
        return c.json(
          {
            error: {
              code: 'IDEMPOTENCY_KEY_REUSED',
              message: 'This Idempotency-Key was already used with a different request body.',
              request_id: requestId,
            },
          },
          422,
        );
      }

      if (existing.status === 'COMPLETED' && existing.responseBody) {
        c.get('logger')?.info({ msg: 'idempotency.replayed', endpoint }, 'replayed response');
        c.header('Idempotent-Replay', 'true');

        return c.json(
          existing.responseBody as Record<string, unknown>,
          (existing.responseStatus ?? 200) as 200 | 201,
        );
      }

      if (existing.status === 'IN_PROGRESS') {
        // The first request has not finished. Returning its eventual answer
        // is impossible, and guessing would be worse than asking for a retry.
        return c.json(
          {
            error: {
              code: 'IDEMPOTENT_REQUEST_IN_PROGRESS',
              message: 'An identical request is already being processed. Retry shortly.',
              request_id: requestId,
            },
          },
          409,
        );
      }
      // status === FAILED falls through and is retried below.
    }

    const expiresAt = new Date(now().getTime() + IDEMPOTENCY_WINDOW_HOURS * 3_600_000);

    try {
      await prisma.idempotencyKey.upsert({
        where: { userId_endpoint_key: { userId, endpoint, key } },
        create: {
          id: newId(),
          key,
          userId,
          endpoint,
          requestHash,
          status: 'IN_PROGRESS',
          expiresAt,
        },
        update: { status: 'IN_PROGRESS', requestHash, expiresAt },
      });
    } catch (error) {
      // Two concurrent requests raced the unique index and this one lost.
      // That is the mutex working, not a failure.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return c.json(
          {
            error: {
              code: 'IDEMPOTENT_REQUEST_IN_PROGRESS',
              message: 'An identical request is already being processed. Retry shortly.',
              request_id: requestId,
            },
          },
          409,
        );
      }
      throw error;
    }

    await next();

    // Record the outcome so a retry can replay it.
    const status = c.res.status;
    let responseBody: unknown = null;

    try {
      responseBody = await c.res.clone().json();
    } catch {
      responseBody = null;
    }

    await prisma.idempotencyKey.update({
      where: { userId_endpoint_key: { userId, endpoint, key } },
      data: {
        // Only 2xx is replayable. Replaying a 500 would make a transient
        // failure permanent for the whole 24-hour window.
        status: status >= 200 && status < 300 ? 'COMPLETED' : 'FAILED',
        responseStatus: status,
        responseBody: responseBody as Prisma.InputJsonValue,
      },
    });

    return undefined;
  });
}
