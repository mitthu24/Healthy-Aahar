import { newId } from '@healthy-aahar/core';
import type { PrismaClient } from '@healthy-aahar/db';
import { createTestClient, setupTestDatabase, truncateAll } from '@healthy-aahar/db/testing';
import { Hono } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { AppBindings } from '../types.js';
import { idempotency } from './idempotency.js';

/**
 * Idempotency foundation tests.
 *
 * PHASE 00 requires idempotency on order and subscription creation (BR-K7),
 * which are PHASE 07 and PHASE 09. The middleware is built and proven now so
 * those phases inherit a tested mechanism rather than each writing their own.
 *
 * Mounted on a throwaway route with the real middleware and a real database —
 * inventing a production endpoint just to test this would be worse.
 */

let prisma: PrismaClient;
let userId: string;

/** Counts handler executions, so a replay can be distinguished from a re-run. */
let executions = 0;

function buildApp(): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.use('*', async (c, next) => {
    c.env = { ...c.env, prisma } as AppBindings['Bindings'];
    c.set('requestId', newId());
    c.set('actor', { kind: 'CUSTOMER', userId, customerProfileId: userId });
    await next();
  });

  app.post('/thing', idempotency({ required: true }), async (c) => {
    executions += 1;
    const body = (await c.req.json()) as { value?: string };
    return c.json({ id: newId(), value: body.value ?? null, executions }, 201);
  });

  app.post('/failing', idempotency({ required: true }), (c) =>
    c.json({ error: { code: 'INTERNAL_ERROR', message: 'boom', request_id: 'x' } }, 500),
  );

  app.post('/optional', idempotency({ required: false }), (c) => c.json({ ok: true }, 200));

  return app;
}

beforeAll(async () => {
  const url = await setupTestDatabase();
  prisma = createTestClient(url);
}, 180_000);

afterAll(async () => {
  await prisma?.$disconnect();
});

beforeEach(async () => {
  await truncateAll(prisma);
  executions = 0;

  const user = await prisma.user.create({
    data: { id: newId(), firebaseUid: `fb-${newId()}`, userType: 'CUSTOMER' },
  });
  userId = user.id;
});

const post = (app: Hono<AppBindings>, path: string, key: string | null, body: unknown) =>
  app.request(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    body: JSON.stringify(body),
  });

describe('idempotency', () => {
  it('requires the header when the route demands it', async () => {
    const res = await post(buildApp(), '/thing', null, { value: 'a' });

    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_FAILED');
  });

  it('allows the header to be absent when the route does not require it', async () => {
    const res = await post(buildApp(), '/optional', null, {});
    expect(res.status).toBe(200);
  });

  it('executes the handler exactly once and replays the stored response', async () => {
    const app = buildApp();
    const key = newId();

    const first = await post(app, '/thing', key, { value: 'hello' });
    const firstBody = (await first.json()) as { id: string; executions: number };

    const second = await post(app, '/thing', key, { value: 'hello' });
    const secondBody = (await second.json()) as { id: string; executions: number };

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    // Same response, and the handler did NOT run again.
    expect(secondBody.id).toBe(firstBody.id);
    expect(executions).toBe(1);
    expect(second.headers.get('idempotent-replay')).toBe('true');
  });

  it('rejects the same key with a different body', async () => {
    // A silent wrong answer would be worse than an error (docs/04 §7.6).
    const app = buildApp();
    const key = newId();

    await post(app, '/thing', key, { value: 'original' });
    const res = await post(app, '/thing', key, { value: 'DIFFERENT' });

    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(executions).toBe(1);
  });

  it('scopes keys per user, so two customers may reuse the same key', async () => {
    const app = buildApp();
    const key = 'shared-key-value';

    await post(app, '/thing', key, { value: 'first-user' });
    const firstUserExecutions = executions;

    const otherUser = await prisma.user.create({
      data: { id: newId(), firebaseUid: `fb-${newId()}`, userType: 'CUSTOMER' },
    });
    userId = otherUser.id;

    const res = await post(app, '/thing', key, { value: 'second-user' });

    expect(res.status).toBe(201);
    expect(executions).toBe(firstUserExecutions + 1);
  });

  it('does not replay a failed response', async () => {
    // Replaying a 500 would make a transient failure permanent for the
    // whole 24-hour window.
    const app = buildApp();
    const key = newId();

    await post(app, '/failing', key, { value: 'x' });

    const record = await prisma.idempotencyKey.findFirst({ where: { key } });
    expect(record?.status).toBe('FAILED');

    const retry = await post(app, '/failing', key, { value: 'x' });
    expect(retry.status).toBe(500);
  });

  it('serialises concurrent requests carrying the same key', async () => {
    // The unique index on (user_id, endpoint, key) is the mutex. Exactly one
    // request may execute the handler; the losers are told to retry.
    const app = buildApp();
    const key = newId();

    const results = await Promise.all(
      Array.from({ length: 6 }, () => post(app, '/thing', key, { value: 'concurrent' })),
    );

    const created = results.filter((r) => r.status === 201);
    const inProgress = results.filter((r) => r.status === 409);

    // Every request is accounted for: created, replayed, or told to retry.
    expect(created.length + inProgress.length).toBe(6);
    // Crucially, the side effect happened once.
    expect(executions).toBe(1);
    expect(await prisma.idempotencyKey.count({ where: { key } })).toBe(1);
  });

  it('stores the response so a later retry can replay it', async () => {
    const app = buildApp();
    const key = newId();

    await post(app, '/thing', key, { value: 'stored' });

    const record = await prisma.idempotencyKey.findFirst({ where: { key } });
    expect(record?.status).toBe('COMPLETED');
    expect(record?.responseStatus).toBe(201);
    expect(record?.responseBody).toMatchObject({ value: 'stored' });
    // A 24-hour window, so a client retrying tomorrow gets a fresh execution.
    expect(record!.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});
