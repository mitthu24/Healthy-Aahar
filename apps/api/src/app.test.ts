import type { ServerEnv } from '@healthy-aahar/config/env/server';
import type { PrismaClient } from '@healthy-aahar/db';
import { createLogger } from '@healthy-aahar/observability';
import { describe, expect, it } from 'vitest';

import { createApp } from './app.js';

const BUSINESS_ID = '0193aaaa-0000-7000-8000-00000000000b';

/**
 * PHASE 01 API tests.
 *
 * These deliberately drive the app through `app.fetch` with **no browser
 * context**: no cookies, no Origin header, no session. That is exactly how a
 * native mobile client will call it, so this suite is the early, continuous
 * check on the mobile-readiness claim rather than a Phase 19 discovery
 * (docs/30-API-MOBILE-APP-READINESS.md §10).
 *
 * Integration tests against a real PostgreSQL arrive in PHASE 02 with the
 * Testcontainers harness.
 */

function testEnv(overrides: Partial<ServerEnv> = {}): ServerEnv {
  return {
    APP_ENV: 'local',
    NODE_ENV: 'test',
    PORT: 4000,
    LOG_LEVEL: 'error',
    APP_VERSION: 'test',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/test',
    DATABASE_POOL_SIZE: 5,
    DATABASE_STATEMENT_TIMEOUT_MS: 10_000,
    ALLOWED_ORIGINS: ['http://localhost:3001'],
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

type PincodeRow = {
  id: string;
  pincode: string;
  areaName: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'COMING_SOON';
  city: {
    id: string;
    name: string;
    slug: string;
    state: string;
    status: 'ACTIVE' | 'INACTIVE' | 'COMING_SOON';
  };
};

const noidaCity = {
  id: '0193aaaa-0000-7000-8000-000000000001',
  name: 'Noida',
  slug: 'noida',
  state: 'Uttar Pradesh',
  status: 'ACTIVE' as const,
};

const rows: PincodeRow[] = [
  {
    id: '0193bbbb-0000-7000-8000-000000000001',
    pincode: '201301',
    areaName: 'Sector 1-18',
    status: 'ACTIVE',
    city: noidaCity,
  },
  {
    id: '0193bbbb-0000-7000-8000-000000000002',
    pincode: '201305',
    areaName: 'Sector 63-80',
    status: 'INACTIVE',
    city: noidaCity,
  },
];

/** Minimal Prisma stand-in — PHASE 01 has no database in CI. */
function fakePrisma(): PrismaClient {
  return {
    servicePincode: {
      findUnique: async ({ where }: { where: { businessId_pincode: { pincode: string } } }) =>
        rows.find((r) => r.pincode === where.businessId_pincode.pincode) ?? null,
    },
    city: {
      findMany: async () => [
        {
          ...noidaCity,
          displayName: 'Noida',
          country: 'IN',
          timezone: 'Asia/Kolkata',
        },
      ],
    },
    $queryRaw: async () => [{ count: 1n }],
  } as unknown as PrismaClient;
}

function buildApp(env = testEnv()) {
  return createApp({
    env,
    prisma: fakePrisma(),
    logger: createLogger({ service: 'api-test', env: 'local', version: 'test', level: 'silent' }),
    businessId: BUSINESS_ID,
  });
}

describe('GET /v1/health', () => {
  it('reports liveness without touching the database', async () => {
    const res = await buildApp().request('/v1/health');
    expect(res.status).toBe(200);

    const body = (await res.json()) as { status: string; version: string; env: string };
    expect(body.status).toBe('ok');
    expect(body.version).toBe('test');
    expect(body.env).toBe('local');
  });

  it('is never cached', async () => {
    const res = await buildApp().request('/v1/health');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('returns a correlation id', async () => {
    const res = await buildApp().request('/v1/health');
    expect(res.headers.get('x-request-id')).toBeTruthy();
  });

  it('echoes a well-formed upstream request id', async () => {
    const res = await buildApp().request('/v1/health', {
      headers: { 'x-request-id': 'cf-trace-12345678' },
    });
    expect(res.headers.get('x-request-id')).toBe('cf-trace-12345678');
  });

  it('ignores a malformed upstream request id rather than logging it', async () => {
    const res = await buildApp().request('/v1/health', {
      headers: { 'x-request-id': 'bad id with spaces <script>' },
    });
    expect(res.headers.get('x-request-id')).not.toContain('script');
  });
});

describe('GET /v1/health/ready', () => {
  it('reports database readiness', async () => {
    const res = await buildApp().request('/v1/health/ready');
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      status: string;
      checks: { database: { status: string; migrations_applied?: number } };
    };
    expect(body.checks.database.status).toBe('ok');
    expect(body.checks.database.migrations_applied).toBe(1);
  });
});

describe('security headers', () => {
  it('sets the documented headers on every response', async () => {
    const res = await buildApp().request('/v1/health');

    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('x-robots-tag')).toContain('noindex');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
  });
});

describe('GET /v1/public/serviceability', () => {
  it('confirms a serviceable pincode', async () => {
    const res = await buildApp().request('/v1/public/serviceability?pincode=201301');
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      is_serviceable: boolean;
      city: { name: string } | null;
      area_name: string | null;
    };
    expect(body.is_serviceable).toBe(true);
    expect(body.city?.name).toBe('Noida');
    expect(body.area_name).toBe('Sector 1-18');
  });

  it('answers 200 — not 404 — for a non-serviceable pincode', async () => {
    // The question was answered successfully. A 404 would make callers treat
    // a valid answer as a failure (docs/06 §4).
    const res = await buildApp().request('/v1/public/serviceability?pincode=201305');
    expect(res.status).toBe(200);

    const body = (await res.json()) as { is_serviceable: boolean; reason: string };
    expect(body.is_serviceable).toBe(false);
    expect(body.reason).toBe('PINCODE_INACTIVE');
  });

  it('answers for a pincode we have never registered', async () => {
    const res = await buildApp().request('/v1/public/serviceability?pincode=999999');
    const body = (await res.json()) as { is_serviceable: boolean; reason: string; message: string };

    expect(body.is_serviceable).toBe(false);
    expect(body.reason).toBe('PINCODE_NOT_FOUND');
    expect(body.message).toBe('Sorry, Healthy Aahar is not currently delivering to this location.');
  });

  it('rejects a malformed pincode with the documented error envelope', async () => {
    const res = await buildApp().request('/v1/public/serviceability?pincode=abc');
    expect(res.status).toBe(422);

    const body = (await res.json()) as {
      error: { code: string; message: string; request_id: string };
    };
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.request_id).toBeTruthy();
  });

  it('never reflects a client-supplied serviceability claim', async () => {
    // A client asserting is_serviceable=true must have no effect whatsoever.
    // The backend recomputes from the database every time (BR-SV1).
    const res = await buildApp().request(
      '/v1/public/serviceability?pincode=201305&is_serviceable=true&isServiceable=true',
    );
    const body = (await res.json()) as { is_serviceable: boolean };

    expect(body.is_serviceable).toBe(false);
  });
});

describe('CORS', () => {
  it('reflects an allowed origin', async () => {
    const res = await buildApp().request('/v1/health', {
      headers: { Origin: 'http://localhost:3001' },
    });
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:3001');
  });

  it('refuses an origin that is not on the allow-list', async () => {
    const res = await buildApp().request('/v1/health', {
      headers: { Origin: 'https://evil.example.com' },
    });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('serves a request with no Origin header at all', async () => {
    // Native mobile clients send no Origin. CORS must not stand in their way.
    const res = await buildApp().request('/v1/health');
    expect(res.status).toBe(200);
  });
});

describe('not found', () => {
  it('returns the documented error envelope', async () => {
    const res = await buildApp().request('/v1/does-not-exist');
    expect(res.status).toBe(404);

    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
  });
});

describe('GET /v1/routes', () => {
  it('publishes the route manifest with audiences', async () => {
    const res = await buildApp().request('/v1/routes');
    const body = (await res.json()) as {
      data: Array<{ path: string; audience: string; permission: string | null }>;
    };

    expect(body.data.length).toBeGreaterThan(0);
    for (const route of body.data) {
      if (route.audience === 'admin') {
        expect(route.permission).toBeTruthy();
      }
    }
  });
});
