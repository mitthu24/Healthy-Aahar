import { createMiddleware } from 'hono/factory';
import type { Context } from 'hono';

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
 *
 * **Known limitation, explicit (Fix #1 review):** `InMemoryRateLimitStore`'s
 * counters live in ONE process's memory. The moment this API runs as more
 * than one instance (horizontal scale, or even two processes on one host
 * during a rolling deploy), each instance enforces the configured limit
 * independently — an attacker spread across N instances effectively gets
 * `N × limit` attempts per window, and a legitimate caller load-balanced
 * across instances can be limited more aggressively than intended (each
 * instance sees only its own share of their requests, so none of them
 * individually hits the limit, OR — depending on load-balancer affinity —
 * they could hit one instance's limit while the others are untouched).
 * Counters also reset on every restart/redeploy. This is the CORRECT
 * trade-off for a single-instance deployment (today's reality, per
 * railway.json) and explicitly NOT safe to rely on once there is more than
 * one instance — at that point `RateLimitStore` must be backed by Redis or
 * equivalent shared storage (PD-14) BEFORE horizontal scale-out, not after.
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
 * Brute-force / abuse protection for the auth entry points that create or
 * validate a credential (Step 6, docs/07 §5) — login for both audiences,
 * AND registration (Fix #1: registration used to have no rate limiting at
 * all, letting an unauthenticated caller force unlimited full-cost scrypt
 * computations and account-creation attempts; it now goes through the
 * identical check as login, under its own bucket).
 *
 * Called explicitly from each route handler, not mounted as app-wide
 * middleware: the limit key needs the request BODY (the email being
 * attempted), and a generic middleware would have to read the body stream
 * before the route handler does, which Hono (and the underlying Web
 * Streams API) does not allow twice.
 *
 * Keyed by IP *and* email together (two independent buckets) so neither a
 * single attacker rotating emails behind one IP nor a distributed attack
 * hammering one specific account slips through on the other axis alone.
 * The email is trimmed and lower-cased before keying, so `Foo@Bar.com `,
 * `foo@bar.com` and `FOO@BAR.COM` all share one bucket rather than each
 * getting their own free attempt budget.
 *
 * `bucket` namespaces admin-login / customer-login / customer-register
 * into independent counters: hammering registration must not also lock a
 * legitimate user out of logging in, and vice versa.
 *
 * Sets the same `X-RateLimit-*` / `Retry-After` response headers the
 * generic `rateLimit()` middleware sets, so a 429 from either path looks
 * identical to a caller (Step 2's "return the established rate-limit error
 * and headers consistently").
 *
 * In-process, like the rest of this file (PD-14) — see the module-level
 * doc comment above for what that does and does not cover once the API
 * runs as more than one instance.
 */
export async function assertAuthRateLimit(
  c: Context<AppBindings>,
  store: RateLimitStore,
  options: {
    enabled: boolean;
    limit: number;
    windowMs?: number;
    bucket: 'admin-login' | 'customer-login' | 'customer-register' | 'password-setup';
    ip: string;
    /** Omitted for token-only endpoints (e.g. password-setup) that carry no account identifier in the body. */
    email?: string;
  },
): Promise<void> {
  if (!options.enabled) return;
  const windowMs = options.windowMs ?? 60_000;

  const byIp = await store.hit(`${options.bucket}:ip:${options.ip}`, windowMs);
  const byEmail = options.email
    ? await store.hit(`${options.bucket}:email:${options.email.trim().toLowerCase()}`, windowMs)
    : undefined;

  const count = Math.max(byIp.count, byEmail?.count ?? 0);
  const resetAt = Math.max(byIp.resetAt, byEmail?.resetAt ?? 0);

  const remaining = Math.max(0, options.limit - count);
  c.header('X-RateLimit-Limit', String(options.limit));
  c.header('X-RateLimit-Remaining', String(remaining));
  c.header('X-RateLimit-Reset', String(Math.ceil(resetAt / 1000)));

  if (count > options.limit) {
    const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
    c.header('Retry-After', String(retryAfter));
    c.get('logger')?.warn({ msg: 'request.rate_limited', bucket: options.bucket }, 'rate limited');
    // Thrown, not returned as JSON directly: the response must look exactly
    // like any other RATE_LIMITED error (same envelope, same error-handler
    // path) regardless of which of these two rate limiters caught it —
    // and, for registration specifically, it must not reveal anything
    // about whether the attempted email is already registered (the 429
    // fires on the IP/email counters alone, before any lookup happens).
    throw new DomainError('RATE_LIMITED', 'Too many requests. Please wait a moment and try again.');
  }
}
