import type { ServerEnv } from '@healthy-aahar/config/env/server';
import type { PrismaClient } from '@healthy-aahar/db';
import {
  createTestClient,
  seedBusiness,
  seedCity,
  seedPincode,
  setupTestDatabase,
  truncateAll,
} from '@healthy-aahar/db/testing';
import { createLogger } from '@healthy-aahar/observability';
import type { Hono } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import type { AppBindings } from './types.js';

/**
 * API integration tests against a REAL database.
 *
 * Every request goes through the whole stack — middleware, Zod validation,
 * service, repository, PostgreSQL — with no cookies and no Origin header,
 * which is exactly how a native mobile client will call it (docs/30 §10).
 */

const ADMIN_TOKEN = 'integration-test-admin-token-value';

let prisma: PrismaClient;
let app: Hono<AppBindings>;
let businessId: string;
/** A second business, to prove nothing leaks between tenants. */
let otherBusinessId: string;

function testEnv(overrides: Partial<ServerEnv> = {}): ServerEnv {
  return {
    APP_ENV: 'local',
    NODE_ENV: 'test',
    PORT: 4000,
    LOG_LEVEL: 'error',
    APP_VERSION: 'test',
    DATABASE_URL: process.env.DATABASE_URL ?? '',
    DATABASE_POOL_SIZE: 5,
    DATABASE_STATEMENT_TIMEOUT_MS: 10_000,
    ALLOWED_ORIGINS: ['http://localhost:3002'],
    FIREBASE_CUSTOMER_PROJECT_ID: 'customer-test',
    FIREBASE_ADMIN_PROJECT_ID: 'admin-test',
    ADMIN_SESSION_MAX_AGE_SECONDS: 43_200,
    ADMIN_SESSION_IDLE_TIMEOUT_SECONDS: 1_800,
    BREVO_SENDER_NAME: 'Healthy Aahar',
    NOTIFICATIONS_ENABLED: false,
    R2_BUCKET_NAME: 'test',
    R2_UPLOAD_MAX_BYTES: 5_242_880,
    R2_PRESIGN_TTL_SECONDS: 300,
    INTERNAL_SERVICE_TOKEN: 'test-internal-token-value',
    ADMIN_DEV_TOKEN: ADMIN_TOKEN,
    DEFAULT_TIMEZONE: 'Asia/Kolkata',
    DEFAULT_CURRENCY: 'INR',
    BOOKING_HORIZON_DAYS: 7,
    SUBSCRIPTION_GENERATION_HORIZON_DAYS: 14,
    SUBSCRIPTION_MATERIALISE_HORIZON_HOURS: 36,
    RATE_LIMIT_ENABLED: false,
    RATE_LIMIT_READ_PER_MIN: 300,
    RATE_LIMIT_WRITE_PER_MIN: 60,
    RATE_LIMIT_ORDER_PER_MIN: 10,
    SENTRY_TRACES_SAMPLE_RATE: 0,
    WORKER_ENABLED: false,
    API_BASE_URL: 'http://localhost:4000',
    OUTBOX_DISPATCH_INTERVAL_MS: 15_000,
    OUTBOX_MAX_ATTEMPTS: 5,
    FEATURE_COUPONS: false,
    FEATURE_REVIEWS: false,
    FEATURE_ONLINE_PAYMENT: false,
    FEATURE_WHATSAPP: false,
    ...overrides,
  } as ServerEnv;
}

const adminHeaders = {
  'X-Dev-Admin-Token': ADMIN_TOKEN,
  'Content-Type': 'application/json',
};

function buildApp(env = testEnv(), scopedBusinessId = businessId) {
  return createApp({
    env,
    prisma,
    logger: createLogger({ service: 'api-it', env: 'local', version: 'test', level: 'silent' }),
    businessId: scopedBusinessId,
  });
}

beforeAll(async () => {
  const url = await setupTestDatabase();
  process.env.DATABASE_URL_TEST = url;
  prisma = createTestClient(url);
}, 180_000);

afterAll(async () => {
  await prisma?.$disconnect();
});

beforeEach(async () => {
  await truncateAll(prisma);
  const main = await seedBusiness(prisma, { slug: 'main-business', name: 'Healthy Aahar' });
  const other = await seedBusiness(prisma, { slug: 'other-business', name: 'Rival Foods' });
  businessId = main.id;
  otherBusinessId = other.id;
  app = buildApp();
});

describe('admin authorization (PHASE 02 dev bypass)', () => {
  it('rejects a request with no token', async () => {
    const res = await app.request('/v1/admin/cities');
    expect(res.status).toBe(401);
  });

  it('rejects a wrong token', async () => {
    const res = await app.request('/v1/admin/cities', {
      headers: { 'X-Dev-Admin-Token': 'wrong-token-value-padding-1234' },
    });
    expect(res.status).toBe(401);
  });

  it('rejects EVERY request when no token is configured — closed, not open', async () => {
    // The failure mode must never be "allow". If ADMIN_DEV_TOKEN is absent,
    // admin routes reject rather than falling through (ADR-030).
    const noToken = testEnv();
    delete (noToken as { ADMIN_DEV_TOKEN?: string }).ADMIN_DEV_TOKEN;

    const res = await buildApp(noToken).request('/v1/admin/cities', { headers: adminHeaders });
    expect(res.status).toBe(401);
  });

  it('refuses outright when APP_ENV is production', async () => {
    // Belt and braces: loadServerEnv already refuses to boot with this set
    // in production, and the middleware refuses at request time too.
    const prod = buildApp(testEnv({ APP_ENV: 'production' }));
    const res = await prod.request('/v1/admin/cities', { headers: adminHeaders });

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
  });
});

describe('city lifecycle', () => {
  it('creates a city as INACTIVE and ignores a smuggled status', async () => {
    const res = await app.request('/v1/admin/cities', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        name: 'Ghaziabad',
        slug: 'ghaziabad',
        state: 'Uttar Pradesh',
        // Status is not an accepted input; it must be stripped (BR-SV5).
        status: 'ACTIVE',
        activated_at: '2020-01-01T00:00:00Z',
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { status: string; is_serviceable: boolean };
    expect(body.status).toBe('INACTIVE');
    expect(body.is_serviceable).toBe(false);
  });

  it('refuses to activate a city that has no ACTIVE pincode', async () => {
    const city = await seedCity(prisma, businessId, { slug: 'no-pincodes' });

    const res = await app.request(`/v1/admin/cities/${city.id}/activate`, {
      method: 'POST',
      headers: adminHeaders,
    });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('CITY_HAS_ACTIVE_PINCODES');
  });

  it('completes the full expansion flow with no deploy', async () => {
    // The requirement the whole design exists to satisfy: a brand new city
    // becomes serviceable purely through admin API calls (BR-SV1).
    const created = await app.request('/v1/admin/cities', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ name: 'Gurgaon', slug: 'gurgaon', state: 'Haryana' }),
    });
    const city = (await created.json()) as { id: string };

    const pinRes = await app.request('/v1/admin/service-pincodes', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ city_id: city.id, pincode: '122001', area_name: 'DLF Phase 1' }),
    });
    const pincode = (await pinRes.json()) as { id: string };

    // Activating the pincode first must be allowed, otherwise the city can
    // never reach its "has an ACTIVE pincode" precondition (the deadlock).
    const activatePin = await app.request(`/v1/admin/service-pincodes/${pincode.id}/activate`, {
      method: 'POST',
      headers: adminHeaders,
    });
    expect(activatePin.status).toBe(200);

    const pinBody = (await activatePin.json()) as {
      status: string;
      is_serviceable: boolean;
      warning?: string;
    };
    expect(pinBody.status).toBe('ACTIVE');
    // Active, but NOT serviceable: the city gate runs first (BR-SV9).
    expect(pinBody.is_serviceable).toBe(false);
    expect(pinBody.warning).toContain('not be serviceable');

    const activateCity = await app.request(`/v1/admin/cities/${city.id}/activate`, {
      method: 'POST',
      headers: adminHeaders,
    });
    expect(activateCity.status).toBe(200);

    // And now it is publicly serviceable.
    const check = await app.request('/v1/public/serviceability?pincode=122001');
    const decision = (await check.json()) as { is_serviceable: boolean; city: { name: string } };

    expect(decision.is_serviceable).toBe(true);
    expect(decision.city.name).toBe('Gurgaon');
  });

  it('deactivating a city makes every pincode in it unserviceable', async () => {
    const city = await seedCity(prisma, businessId, { slug: 'noida', status: 'ACTIVE' });
    await seedPincode(prisma, businessId, city.id, { pincode: '201301', status: 'ACTIVE' });

    const before = await app.request('/v1/public/serviceability?pincode=201301');
    expect(((await before.json()) as { is_serviceable: boolean }).is_serviceable).toBe(true);

    const res = await app.request(`/v1/admin/cities/${city.id}/deactivate`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ reason: 'Temporary kitchen closure' }),
    });
    expect(res.status).toBe(200);

    // The pincode is still ACTIVE, but the city gate overrides it (BR-SV9).
    const after = await app.request('/v1/public/serviceability?pincode=201301');
    const decision = (await after.json()) as { is_serviceable: boolean; reason: string };

    expect(decision.is_serviceable).toBe(false);
    expect(decision.reason).toBe('CITY_INACTIVE');

    const row = await prisma.servicePincode.findFirst({ where: { pincode: '201301' } });
    expect(row?.status).toBe('ACTIVE');
  });

  it('requires a reason to deactivate', async () => {
    const city = await seedCity(prisma, businessId, { slug: 'x', status: 'ACTIVE' });

    const res = await app.request(`/v1/admin/cities/${city.id}/deactivate`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ reason: '' }),
    });

    expect(res.status).toBe(422);
  });

  it('never deletes data when deactivating', async () => {
    // BR-SV6: switching off prevents NEW serviceability, nothing more.
    const city = await seedCity(prisma, businessId, { slug: 'keepme', status: 'ACTIVE' });
    await seedPincode(prisma, businessId, city.id, { pincode: '201399', status: 'ACTIVE' });

    await app.request(`/v1/admin/cities/${city.id}/deactivate`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ reason: 'Pausing operations' }),
    });

    expect(await prisma.city.count({ where: { id: city.id } })).toBe(1);
    expect(await prisma.servicePincode.count({ where: { cityId: city.id } })).toBe(1);
  });
});

describe('business isolation', () => {
  it('does not list another business city', async () => {
    await seedCity(prisma, otherBusinessId, { slug: 'rival-city', name: 'Rival City' });

    const res = await app.request('/v1/admin/cities', { headers: adminHeaders });
    const body = (await res.json()) as { data: Array<{ name: string }> };

    expect(body.data.find((c) => c.name === 'Rival City')).toBeUndefined();
  });

  it('returns 404 — not 403 — for another business city', async () => {
    // A 403 would confirm the id exists, which is an enumeration oracle
    // (docs/06 §1.6).
    const rival = await seedCity(prisma, otherBusinessId, { slug: 'rival-2' });

    const res = await app.request(`/v1/admin/cities/${rival.id}`, { headers: adminHeaders });
    expect(res.status).toBe(404);

    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('CITY_NOT_FOUND');
  });

  it('refuses to create a pincode against another business city', async () => {
    const rival = await seedCity(prisma, otherBusinessId, { slug: 'rival-3' });

    const res = await app.request('/v1/admin/service-pincodes', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ city_id: rival.id, pincode: '560001' }),
    });

    expect(res.status).toBe(404);
    expect(await prisma.servicePincode.count({ where: { pincode: '560001' } })).toBe(0);
  });

  it('refuses to update another business city', async () => {
    const rival = await seedCity(prisma, otherBusinessId, { slug: 'rival-4', name: 'Untouched' });

    const res = await app.request(`/v1/admin/cities/${rival.id}`, {
      method: 'PATCH',
      headers: adminHeaders,
      body: JSON.stringify({ name: 'Hijacked' }),
    });

    expect(res.status).toBe(404);
    const row = await prisma.city.findUnique({ where: { id: rival.id } });
    expect(row?.name).toBe('Untouched');
  });

  it('resolves serviceability only within the scoped business', async () => {
    // The same pincode in two businesses must resolve independently.
    const mine = await seedCity(prisma, businessId, { slug: 'mine', status: 'ACTIVE' });
    await seedPincode(prisma, businessId, mine.id, { pincode: '500001', status: 'INACTIVE' });

    const theirs = await seedCity(prisma, otherBusinessId, { slug: 'theirs', status: 'ACTIVE' });
    await seedPincode(prisma, otherBusinessId, theirs.id, {
      pincode: '500001',
      status: 'ACTIVE',
    });

    const mineRes = await app.request('/v1/public/serviceability?pincode=500001');
    expect(((await mineRes.json()) as { is_serviceable: boolean }).is_serviceable).toBe(false);

    const theirsApp = buildApp(testEnv(), otherBusinessId);
    const theirsRes = await theirsApp.request('/v1/public/serviceability?pincode=500001');
    expect(((await theirsRes.json()) as { is_serviceable: boolean }).is_serviceable).toBe(true);
  });
});

describe('cursor pagination', () => {
  beforeEach(async () => {
    const city = await seedCity(prisma, businessId, { slug: 'paged', status: 'ACTIVE' });
    for (let i = 0; i < 12; i += 1) {
      await seedPincode(prisma, businessId, city.id, {
        pincode: String(110001 + i),
        status: 'INACTIVE',
      });
    }
  });

  it('walks every row exactly once with no duplicates or gaps', async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;

    do {
      const url: string = `/v1/admin/service-pincodes?limit=5${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const res = await app.request(url, { headers: adminHeaders });
      const body = (await res.json()) as {
        data: Array<{ pincode: string }>;
        pagination: { next_cursor: string | null; has_more: boolean };
      };

      seen.push(...body.data.map((p) => p.pincode));
      cursor = body.pagination.next_cursor;
      pages += 1;
    } while (cursor && pages < 10);

    expect(seen).toHaveLength(12);
    expect(new Set(seen).size).toBe(12);
    // Ordering is stable and ascending, which is what makes the keyset work.
    expect([...seen].sort()).toEqual(seen);
  });

  it('rejects a malformed cursor rather than silently returning page one', async () => {
    const res = await app.request('/v1/admin/service-pincodes?cursor=not-a-real-cursor', {
      headers: adminHeaders,
    });
    expect(res.status).toBe(422);
  });

  it('caps the limit so no caller can request an unbounded page', async () => {
    const res = await app.request('/v1/admin/service-pincodes?limit=10000', {
      headers: adminHeaders,
    });
    expect(res.status).toBe(422);
  });
});

describe('concurrency', () => {
  it('allows only one of two concurrent identical pincode creations', async () => {
    // The unique index is the arbiter. Without it both would succeed and a
    // pincode would resolve to two cities (BR-SV2).
    const city = await seedCity(prisma, businessId, { slug: 'race', status: 'ACTIVE' });

    const attempt = () =>
      app.request('/v1/admin/service-pincodes', {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({ city_id: city.id, pincode: '400001' }),
      });

    const results = await Promise.all([attempt(), attempt(), attempt(), attempt(), attempt()]);
    const created = results.filter((r) => r.status === 201);

    expect(created).toHaveLength(1);
    expect(await prisma.servicePincode.count({ where: { pincode: '400001' } })).toBe(1);
  });

  it('keeps city activation consistent under concurrent calls', async () => {
    const city = await seedCity(prisma, businessId, { slug: 'concurrent-activate' });
    await seedPincode(prisma, businessId, city.id, { pincode: '600001', status: 'ACTIVE' });

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        app.request(`/v1/admin/cities/${city.id}/activate`, {
          method: 'POST',
          headers: adminHeaders,
        }),
      ),
    );

    // Activation is idempotent, so every concurrent call succeeds and the
    // row ends in exactly one state.
    expect(results.every((r) => r.status === 200)).toBe(true);

    const row = await prisma.city.findUnique({ where: { id: city.id } });
    expect(row?.status).toBe('ACTIVE');
    expect(row?.activatedAt).not.toBeNull();
  });
});

describe('error envelope', () => {
  it('returns the documented shape with a request id', async () => {
    const res = await app.request('/v1/admin/cities', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ name: '', slug: 'Bad Slug!', state: '' }),
    });

    expect(res.status).toBe(422);
    const body = (await res.json()) as {
      error: { code: string; message: string; request_id: string; details?: unknown[] };
    };

    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.request_id).toBeTruthy();
    expect(Array.isArray(body.error.details)).toBe(true);
  });

  it('never leaks SQL, stack traces or connection strings', async () => {
    const res = await app.request('/v1/admin/cities/not-a-uuid', { headers: adminHeaders });
    const text = await res.text();

    expect(text).not.toMatch(/postgresql:\/\//);
    expect(text).not.toMatch(/at .*\.ts:\d+/);
    expect(text).not.toMatch(/SELECT |INSERT INTO|prisma\./i);
  });
});

describe('OpenAPI document', () => {
  it('is generated and describes the implemented routes', async () => {
    const res = await app.request('/v1/openapi.json');
    expect(res.status).toBe(200);

    const doc = (await res.json()) as {
      openapi: string;
      paths: Record<string, Record<string, unknown>>;
    };

    expect(doc.openapi).toBe('3.1.0');
    expect(doc.paths['/v1/admin/cities']).toBeDefined();
    expect(doc.paths['/v1/public/serviceability']).toBeDefined();
    expect(doc.paths['/v1/health']).toBeDefined();
  });

  it('does not advertise status as a settable field on city creation', async () => {
    // The document is generated from the same Zod schema the API validates
    // with, so this proves the property structurally rather than by comment.
    const res = await app.request('/v1/openapi.json');
    const doc = (await res.json()) as Record<string, never>;

    const schema = (
      doc as unknown as {
        paths: Record<
          string,
          Record<
            string,
            {
              requestBody?: { content: { 'application/json': { schema: { properties: object } } } };
            }
          >
        >;
      }
    ).paths['/v1/admin/cities']?.post?.requestBody?.content['application/json'].schema;

    expect(schema?.properties).toBeDefined();
    expect(Object.keys(schema!.properties)).not.toContain('status');
  });
});
