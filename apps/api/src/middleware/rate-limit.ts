import { createMiddleware } from 'hono/factory';

import { DomainError } from '@healthy-aahar/core';

import type { AppBindings } from '../types.js';

/**
 * Per-caller rate limiting.
 *
 * PHASE 01 uses an in-process sliding window, which is correct while the API
 * runs as a single instance (docs/23-SECURITY-ARCHITECTURE.md §8). It is the
 * *second* layer: Cloudflare already rate-limits coarsely per IP, and this
 * layer limits precisely per user once authentication lands in PHASE 03.
 *
 * Migration path is deliberate and documented: when the API scales
 * horizontally, swap the store for Redis (PD-14). The interface below is what
 * makes that a one-file change — nothing else knows how counters are stored.
 */

export interface RateLimitStore {
  /** Returns the request count in the window after recording this hit. */
  hit(key: string, windowMs: number): Promise<{ count: number; resetAt: number }>;
}

export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();
  private readonly sweepIntervalMs = 60_000;
  private lastSweep = 0;

  async hit(key: string, windowMs: number): Promise<{ count: number; resetAt: number }> {
    const now = Date.now();
    this.sweep(now);

    const existing = this.buckets.get(key);
    if (!existing || existing.resetAt <= now) {
      const fresh = { count: 1, resetAt: now + windowMs };
      this.buckets.set(key, fresh);
      return fresh;
    }

    existing.count += 1;
    return existing;
  }

  /** Without this, the map grows unbounded and becomes a slow memory leak. */
  private sweep(now: number): void {
    if (now - this.lastSweep < this.sweepIntervalMs) return;
    this.lastSweep = now;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}

export type RateLimitOptions = {
  store: RateLimitStore;
  limit: number;
  windowMs?: number;
  enabled: boolean;
  /** Distinguishes buckets so a read limit and a write limit do not share one. */
  bucket: string;
};

export function rateLimit(options: RateLimitOptions) {
  const windowMs = options.windowMs ?? 60_000;

  return createMiddleware<AppBindings>(async (c, next) => {
    if (!options.enabled) return next();

    const actor = c.get('actor');
    // Prefer a stable identity over an IP: many Indian mobile users share a
    // carrier NAT address, so limiting purely by IP would throttle unrelated
    // customers together.
    const identity =
      actor && actor.kind !== 'ANONYMOUS' && 'userId' in actor
        ? `user:${actor.userId}`
        : `ip:${c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? 'unknown'}`;

    const { count, resetAt } = await options.store.hit(`${options.bucket}:${identity}`, windowMs);

    const remaining = Math.max(0, options.limit - count);
    c.header('X-RateLimit-Limit', String(options.limit));
    c.header('X-RateLimit-Remaining', String(remaining));
    c.header('X-RateLimit-Reset', String(Math.ceil(resetAt / 1000)));

    if (count > options.limit) {
      const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
      c.header('Retry-After', String(retryAfter));

      c.get('logger')?.warn(
        { msg: 'request.rate_limited', bucket: options.bucket },
        'rate limited',
      );

      return c.json(
        {
          error: {
            code: 'RATE_LIMITED',
            message: 'Too many requests. Please wait a moment and try again.',
            request_id: c.get('requestId'),
          },
        },
        429,
      );
    }

    await next();
    return undefined;
  });
}

/**
 * Brute-force protection for login endpoints (Step 6, docs/07 §5).
 *
 * Called explicitly from each login route handler, not mounted as
 * app-wide middleware: the limit key needs the request BODY (the email
 * being attempted), and a generic middleware would have to read the body
 * stream before the route handler does, which Hono (and the underlying Web
 * Streams API) does not allow twice.
 *
 * Keyed by IP *and* email together (two independent buckets) so neither a
 * single attacker rotating emails behind one IP nor a distributed attack
 * hammering one specific account slips through on the other axis alone.
 *
 * In-process, like the rest of this file (PD-14): correct for a single API
 * instance, and the store is the one seam that changes to Redis if the API
 * ever scales horizontally — nothing here assumes in-memory storage beyond
 * that one injected `store`.
 */
export async function assertLoginNotRateLimited(
  store: RateLimitStore,
  options: { enabled: boolean; limit: number; windowMs?: number; ip: string; email: string },
): Promise<void> {
  if (!options.enabled) return;
  const windowMs = options.windowMs ?? 60_000;

  const byIp = await store.hit(`login-attempt:ip:${options.ip}`, windowMs);
  const byEmail = await store.hit(`login-attempt:email:${options.email.toLowerCase()}`, windowMs);

  if (byIp.count > options.limit || byEmail.count > options.limit) {
    throw new DomainError('RATE_LIMITED', 'Too many login attempts. Please wait a moment and try again.');
  }
}
