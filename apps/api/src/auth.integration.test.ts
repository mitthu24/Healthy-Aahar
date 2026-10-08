import type { ServerEnv } from '@healthy-aahar/config/env/server';
import { PERMISSIONS } from '@healthy-aahar/core';
import type { PrismaClient } from '@healthy-aahar/db';
import {
  createTestClient,
  seedAdminUser,
  seedBusiness,
  seedCustomerUser,
  seedPermissions,
  seedRole,
  setupTestDatabase,
  truncateAll,
} from '@healthy-aahar/db/testing';
import { createLogger } from '@healthy-aahar/observability';
import type { Hono } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import { loginAsAdmin } from './test-support/admin-session.js';
import type { AppBindings } from './types.js';

/**
 * PHASE 03 — authentication integration tests, against a real database and
 * the REAL `/v1/auth/*` and `/v1/admin/auth/*` routes. Email/password and
 * DB-backed sessions need no external service, so unlike the Firebase-era
 * version of this suite, there is no faked boundary at all — every request
 * exercises the exact code path production uses, including password
 * hashing and session-token lookups.
 */

let prisma: PrismaClient;
let app: Hono<AppBindings>;
let businessId: string;

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
    ADMIN_SESSION_MAX_AGE_SECONDS: 43_200,
    ADMIN_SESSION_IDLE_TIMEOUT_SECONDS: 1_800,
    CUSTOMER_SESSION_MAX_AGE_SECONDS: 2_592_000,
    LOGIN_RATE_LIMIT_PER_MIN: 5,
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

describe('customer registration (docs/07 §4)', () => {
  it('creates a user + profile and returns 201 with a usable session token', async () => {
    const res = await app.request('/v1/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'new.customer@example.test', password: 'a-strong-password-1', phone: '+919876500001' }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { user: { email: string; phone: string | null }; token: string };
    expect(body.user.email).toBe('new.customer@example.test');
    expect(body.user.phone).toBe('+919876500001');
    expect(body.token).toBeTruthy();

    // The password hash is never returned by any API response (Step 13).
    expect(JSON.stringify(body)).not.toMatch(/scrypt:/);

    const row = await prisma.user.findUnique({
      where: { email_userType: { email: 'new.customer@example.test', userType: 'CUSTOMER' } },
    });
    expect(row).not.toBeNull();
    expect(row!.passwordHash).toMatch(/^scrypt:/);
    const profile = await prisma.customerProfile.findUnique({ where: { userId: row!.id } });
    expect(profile).not.toBeNull();

    // The returned token immediately authenticates.
    const me = await app.request('/v1/auth/me', { headers: { Authorization: `Bearer ${body.token}` } });
    expect(me.status).toBe(200);
  });

  it('rejects a duplicate email with 409, not a silent merge', async () => {
    const register = () =>
      app.request('/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'dup@example.test', password: 'a-strong-password-1' }),
      });

    const first = await register();
    expect(first.status).toBe(201);

    const second = await register();
    expect(second.status).toBe(409);
    const body = (await second.json()) as { error: { code: string } };
    expect(body.error.code).toBe('EMAIL_ALREADY_REGISTERED');

    expect(await prisma.user.count({ where: { email: 'dup@example.test' } })).toBe(1);
  });

  it('allows exactly one winner under 10 concurrent registrations for the same email', async () => {
    const attempt = () =>
      app.request('/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'race@example.test', password: 'a-strong-password-1' }),
      });

    const results = await Promise.all(Array.from({ length: 10 }, attempt));
    const created = results.filter((r) => r.status === 201);
    const conflicted = results.filter((r) => r.status === 409);

    expect(created).toHaveLength(1);
    expect(conflicted).toHaveLength(9);
    expect(await prisma.user.count({ where: { email: 'race@example.test' } })).toBe(1);
  });

  it('rejects a password shorter than the minimum', async () => {
    const res = await app.request('/v1/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'short-pw@example.test', password: 'short1' }),
    });
    expect(res.status).toBe(422);
  });
});

describe('customer login (docs/07 §4)', () => {
  it('logs in with the correct password', async () => {
    const customer = await seedCustomerUser(prisma, businessId, { email: 'login@example.test', password: 'the-real-password-1' });

    const res = await app.request('/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: customer.email, password: customer.password }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string };
    expect(body.token).toBeTruthy();
  });

  it('rejects a wrong password with a generic message — no hint which part failed', async () => {
    const customer = await seedCustomerUser(prisma, businessId, { email: 'wrong-pw@example.test' });

    const res = await app.request('/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: customer.email, password: 'definitely-not-it' }),
    });

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects an unknown email with the SAME generic error as a wrong password (no enumeration)', async () => {
    const res = await app.request('/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nobody-here@example.test', password: 'whatever-1234' }),
    });

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects a suspended account with the same generic error, not a distinguishing one', async () => {
    const customer = await seedCustomerUser(prisma, businessId, { email: 'suspended@example.test', status: 'SUSPENDED' });

    const res = await app.request('/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: customer.email, password: customer.password }),
    });

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects GET /v1/auth/me with no bearer token', async () => {
    const res = await app.request('/v1/auth/me');
    expect(res.status).toBe(401);
  });

  it('rejects GET /v1/auth/me for an unknown/forged bearer token', async () => {
    const res = await app.request('/v1/auth/me', { headers: { Authorization: 'Bearer not-a-real-session-token' } });
    expect(res.status).toBe(401);
  });

  it("a customer's credentials are rejected on the admin login route — different user_type, same email space", async () => {
    const customer = await seedCustomerUser(prisma, businessId, { email: 'customer-not-admin@example.test' });

    const res = await app.request('/v1/admin/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: customer.email, password: customer.password }),
    });
    expect(res.status).toBe(401);
  });

  it('logout revokes the session and a subsequent request is rejected', async () => {
    const customer = await seedCustomerUser(prisma, businessId, { email: 'logout@example.test' });
    const login = await app.request('/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: customer.email, password: customer.password }),
    });
    const { token } = (await login.json()) as { token: string };

    const logout = await app.request('/v1/auth/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(logout.status).toBe(200);

    const after = await app.request('/v1/auth/me', { headers: { Authorization: `Bearer ${token}` } });
    expect(after.status).toBe(401);
  });
});

describe('admin session lifecycle (docs/07 §5)', () => {
  it('logs in, resolves permissions, and GET /me matches the login response', async () => {
    const role = await seedRole(prisma, businessId, { key: 'ADMIN_IT_ROLE', permissionKeys: ['dashboard:read'] });
    const admin = await seedAdminUser(prisma, businessId, { roleIds: [role.id], fullName: 'Priya Admin' });

    const session = await loginAsAdmin(app, admin);

    const me = await app.request('/v1/admin/auth/me', { headers: session.headers });
    expect(me.status).toBe(200);
    const body = (await me.json()) as { full_name: string; permissions: string[]; roles: string[] };
    expect(body.full_name).toBe('Priya Admin');
    expect(body.permissions).toContain('dashboard:read');
    expect(body.roles).toContain('ADMIN_IT_ROLE');
  });

  it('rejects an unknown admin email — /v1/admin/auth/login never creates a user', async () => {
    const res = await app.request('/v1/admin/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'no-such-admin@example.test', password: 'whatever-1234' }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects an admin who has not completed password setup (password_hash is NULL)', async () => {
    const admin = await seedAdminUser(prisma, businessId, { noPassword: true });

    const res = await app.request('/v1/admin/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: admin.email, password: admin.password }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('logout clears the session and a subsequent request is rejected', async () => {
    const admin = await seedAdminUser(prisma, businessId, {});
    const session = await loginAsAdmin(app, admin);

    const logout = await app.request('/v1/admin/auth/logout', { method: 'POST', headers: session.headers });
    expect(logout.status).toBe(200);

    const after = await app.request('/v1/admin/auth/me', { headers: session.headers });
    expect(after.status).toBe(401);
  });

  it('an absolute session lifetime beyond ADMIN_SESSION_MAX_AGE_SECONDS is rejected', async () => {
    const admin = await seedAdminUser(prisma, businessId, {});
    // -1s: the session is created already expired, so the very next request fails.
    const shortLived = buildApp(testEnv({ ADMIN_SESSION_MAX_AGE_SECONDS: -1 }));

    const loginRes = await shortLived.request('/v1/admin/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: admin.email, password: admin.password }),
    });
    const setCookies = loginRes.headers.getSetCookie?.() ?? [];
    const cookieHeader = setCookies.map((c) => c.split(';')[0]).join('; ');

    const res = await shortLived.request('/v1/admin/auth/me', { headers: { Cookie: cookieHeader } });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('SESSION_EXPIRED');
  });

  it('an idle session beyond ADMIN_SESSION_IDLE_TIMEOUT_SECONDS is rejected', async () => {
    const admin = await seedAdminUser(prisma, businessId, {});
    const shortIdle = buildApp(testEnv({ ADMIN_SESSION_IDLE_TIMEOUT_SECONDS: 1 }));

    const session = await loginAsAdmin(shortIdle, admin);

    // Simulate idle time by moving the session's last_seen_at into the past
    // directly — waiting 1s+ in a test is slow and flaky by comparison, and
    // this exercises exactly the same comparison the middleware makes.
    await prisma.session.updateMany({
      where: { userId: admin.userId },
      data: { lastSeenAt: new Date(Date.now() - 5_000) },
    });

    const res = await shortIdle.request('/v1/admin/auth/me', { headers: session.headers });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('SESSION_EXPIRED');
  });

  it('rejects a suspended admin on the very next request even with a cryptographically valid session', async () => {
    const admin = await seedAdminUser(prisma, businessId, {});
    const session = await loginAsAdmin(app, admin);

    await prisma.user.update({ where: { id: admin.userId }, data: { status: 'SUSPENDED' } });

    const res = await app.request('/v1/admin/auth/me', { headers: session.headers });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('ACCOUNT_SUSPENDED');
  });
});

describe('login rate limiting (Step 6)', () => {
  it('rate-limits repeated failed login attempts from the same account', async () => {
    const limited = buildApp(testEnv({ RATE_LIMIT_ENABLED: true, LOGIN_RATE_LIMIT_PER_MIN: 3 }));
    const attempt = () =>
      limited.request('/v1/admin/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'brute-force@example.test', password: 'guess' }),
      });

    const results = [];
    for (let i = 0; i < 5; i += 1) results.push(await attempt());

    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 401)).toHaveLength(3);
    expect(statuses.filter((s) => s === 429)).toHaveLength(2);
  });
});
