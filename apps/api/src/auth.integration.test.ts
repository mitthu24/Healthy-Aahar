import type { ServerEnv } from '@healthy-aahar/config/env/server';
import { PERMISSIONS } from '@healthy-aahar/core';
import type { PrismaClient } from '@healthy-aahar/db';
import {
  createTestClient,
  seedAdminUser,
  seedBusiness,
  seedPermissions,
  seedRole,
  setupTestDatabase,
  truncateAll,
} from '@healthy-aahar/db/testing';
import { createLogger } from '@healthy-aahar/observability';
import type { Hono } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import { fakeToken, FakeAdminSession, FakeTokenVerifier } from './test-support/fake-auth.js';
import { loginAsAdmin } from './test-support/admin-session.js';
import type { AppBindings } from './types.js';

/**
 * PHASE 03 — authentication integration tests, against a real database and
 * the REAL `/v1/auth/*` and `/v1/admin/auth/*` routes. Only the Firebase
 * boundary itself is faked — see `test-support/fake-auth.ts`.
 */

let prisma: PrismaClient;
let app: Hono<AppBindings>;
let businessId: string;

const customerVerifier = new FakeTokenVerifier();
const adminVerifier = new FakeTokenVerifier();
const adminSession = new FakeAdminSession();

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
    ADMIN_CSRF_SECRET: 'test-csrf-secret-value',
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

function buildApp(env = testEnv(), scopedBusinessId = businessId) {
  return createApp({
    env,
    prisma,
    logger: createLogger({ service: 'auth-it', env: 'local', version: 'test', level: 'silent' }),
    businessId: scopedBusinessId,
    authOverrides: { customerVerifier, adminVerifier, adminSession },
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
  const business = await seedBusiness(prisma, { slug: 'auth-it', name: 'Healthy Aahar' });
  businessId = business.id;
  await seedPermissions(prisma, PERMISSIONS);
  app = buildApp();
});

describe('customer session exchange (docs/07 §4.2)', () => {
  it('provisions a user + profile on first sign-in and returns 201', async () => {
    const res = await app.request('/v1/auth/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id_token: fakeToken({ uid: 'cust-1', phoneNumber: '+919876500001' }) }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { user: { phone: string | null }; profile: { id: string } };
    expect(body.user.phone).toBe('+919876500001');

    const row = await prisma.user.findUnique({
      where: { firebaseUid_userType: { firebaseUid: 'cust-1', userType: 'CUSTOMER' } },
    });
    expect(row).not.toBeNull();
    const profile = await prisma.customerProfile.findUnique({ where: { userId: row!.id } });
    expect(profile).not.toBeNull();
  });

  it('resumes a returning customer with 200 and does not duplicate the row', async () => {
    const token = fakeToken({ uid: 'cust-2', phoneNumber: '+919876500002' });
    await app.request('/v1/auth/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id_token: token }),
    });

    const res = await app.request('/v1/auth/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id_token: token }),
    });

    expect(res.status).toBe(200);
    const count = await prisma.user.count({
      where: { firebaseUid: 'cust-2', userType: 'CUSTOMER' },
    });
    expect(count).toBe(1);
  });

  it('provisions exactly one user under 10 concurrent first sign-ins for the same identity', async () => {
    const token = fakeToken({ uid: 'cust-race', phoneNumber: '+919876500099' });
    const attempt = () =>
      app.request('/v1/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_token: token }),
      });

    const results = await Promise.all(Array.from({ length: 10 }, attempt));
    expect(results.every((r) => r.status === 200 || r.status === 201)).toBe(true);

    const count = await prisma.user.count({ where: { firebaseUid: 'cust-race', userType: 'CUSTOMER' } });
    expect(count).toBe(1);
  });

  it('rejects GET /v1/auth/me with no bearer token', async () => {
    const res = await app.request('/v1/auth/me');
    expect(res.status).toBe(401);
  });

  it('rejects GET /v1/auth/me for a token with no provisioned user — session is the only route that creates one', async () => {
    const res = await app.request('/v1/auth/me', {
      headers: { Authorization: `Bearer ${fakeToken({ uid: 'never-signed-up' })}` },
    });
    expect(res.status).toBe(401);
  });

  it('rejects a suspended customer on the very next request', async () => {
    const token = fakeToken({ uid: 'cust-suspended', phoneNumber: '+919876500003' });
    await app.request('/v1/auth/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id_token: token }),
    });

    await prisma.user.updateMany({
      where: { firebaseUid: 'cust-suspended' },
      data: { status: 'SUSPENDED' },
    });

    const res = await app.request('/v1/auth/me', { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('ACCOUNT_SUSPENDED');
  });

  it('a customer token is rejected on the admin session route — different audience, different verifier', async () => {
    // The fake verifiers are separate instances (as the real two-Firebase-
    // project verifiers are), so a token this suite issued for the customer
    // verifier is meaningless to the admin verifier's identity space —
    // there is no shared uid to resolve, mirroring ADR-010's guarantee.
    const res = await app.request('/v1/admin/auth/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id_token: fakeToken({ uid: 'cust-1' }) }),
    });
    // No admin account exists under this uid in the ADMIN identity space.
    expect(res.status).toBe(401);
  });
});

describe('admin session lifecycle (docs/07 §5)', () => {
  it('logs in, resolves permissions, and GET /me matches the login response', async () => {
    const role = await seedRole(prisma, businessId, { key: 'ADMIN_IT_ROLE', permissionKeys: ['dashboard:read'] });
    const admin = await seedAdminUser(prisma, businessId, { roleIds: [role.id], fullName: 'Priya Admin' });

    const session = await loginAsAdmin(app, admin.firebaseUid);

    const me = await app.request('/v1/admin/auth/me', { headers: session.headers });
    expect(me.status).toBe(200);
    const body = (await me.json()) as { full_name: string; permissions: string[]; roles: string[] };
    expect(body.full_name).toBe('Priya Admin');
    expect(body.permissions).toContain('dashboard:read');
    expect(body.roles).toContain('ADMIN_IT_ROLE');
  });

  it('rejects an unknown admin identity — /v1/admin/auth/session never creates a user', async () => {
    const res = await app.request('/v1/admin/auth/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id_token: fakeToken({ uid: 'no-such-admin' }) }),
    });
    expect(res.status).toBe(401);
  });

  it('logout clears the session and a subsequent request is rejected', async () => {
    const admin = await seedAdminUser(prisma, businessId, {});
    const session = await loginAsAdmin(app, admin.firebaseUid);

    const logout = await app.request('/v1/admin/auth/logout', { method: 'POST', headers: session.headers });
    expect(logout.status).toBe(200);

    const after = await app.request('/v1/admin/auth/me', { headers: session.headers });
    expect(after.status).toBe(401);
  });

  it('an absolute session lifetime beyond ADMIN_SESSION_MAX_AGE_SECONDS is rejected', async () => {
    const admin = await seedAdminUser(prisma, businessId, {});
    const shortLived = buildApp(testEnv({ ADMIN_SESSION_MAX_AGE_SECONDS: 1 }));

    const loginRes = await shortLived.request('/v1/admin/auth/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // authTime far in the past — beyond the 1-second max age configured above.
      body: JSON.stringify({ id_token: fakeToken({ uid: admin.firebaseUid, authTime: Math.floor(Date.now() / 1000) - 999 }) }),
    });
    const setCookies = loginRes.headers.getSetCookie?.() ?? [];
    const cookieHeader = setCookies.map((c) => c.split(';')[0]).join('; ');

    const res = await shortLived.request('/v1/admin/auth/me', { headers: { Cookie: cookieHeader } });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('SESSION_EXPIRED');
  });
});
