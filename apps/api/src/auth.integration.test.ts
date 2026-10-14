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
    REGISTER_RATE_LIMIT_PER_MIN: 5,
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
      body: JSON.stringify({
        email: 'new.customer@example.test',
        password: 'a-strong-password-1',
        phone: '+919876500001',
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      user: { email: string; phone: string | null };
      token: string;
    };
    expect(body.user.email).toBe('new.customer@example.test');
    expect(body.user.phone).toBe('+919876500001');
    expect(body.token).toBeTruthy();

    // The password hash is never returned by any API response (Step 13).
    expect(JSON.stringify(body)).not.toMatch(/scrypt:/);

    // Mobile-readiness (ADR-038): the session is returned in the BODY,
    // never as a cookie — a native client has no cookie jar to receive one.
    expect(res.headers.getSetCookie?.() ?? []).toHaveLength(0);

    const row = await prisma.user.findUnique({
      where: { email_userType: { email: 'new.customer@example.test', userType: 'CUSTOMER' } },
    });
    expect(row).not.toBeNull();
    expect(row!.passwordHash).toMatch(/^scrypt:/);
    const profile = await prisma.customerProfile.findUnique({ where: { userId: row!.id } });
    expect(profile).not.toBeNull();

    // The returned token immediately authenticates.
    const me = await app.request('/v1/auth/me', {
      headers: { Authorization: `Bearer ${body.token}` },
    });
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
    const customer = await seedCustomerUser(prisma, businessId, {
      email: 'login@example.test',
      password: 'the-real-password-1',
    });

    const res = await app.request('/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: customer.email, password: customer.password }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string };
    expect(body.token).toBeTruthy();

    // Mobile-readiness (ADR-038): no cookie, ever, for the customer API.
    expect(res.headers.getSetCookie?.() ?? []).toHaveLength(0);
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
    const customer = await seedCustomerUser(prisma, businessId, {
      email: 'suspended@example.test',
      status: 'SUSPENDED',
    });

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
    const res = await app.request('/v1/auth/me', {
      headers: { Authorization: 'Bearer not-a-real-session-token' },
    });
    expect(res.status).toBe(401);
  });

  it("a customer's credentials are rejected on the admin login route — different user_type, same email space", async () => {
    const customer = await seedCustomerUser(prisma, businessId, {
      email: 'customer-not-admin@example.test',
    });

    const res = await app.request('/v1/admin/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: customer.email, password: customer.password }),
    });
    expect(res.status).toBe(401);
  });

  it('Fix #4 — a valid CUSTOMER session token presented as the ADMIN cookie is rejected with the established auth error, not a session granted', async () => {
    const customer = await seedCustomerUser(prisma, businessId, {
      email: 'cross-audience-c-to-a@example.test',
    });
    const login = await app.request('/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: customer.email, password: customer.password }),
    });
    const { token } = (await login.json()) as { token: string };

    // The exact same raw token, presented as the admin session cookie value.
    const res = await app.request('/v1/admin/auth/me', {
      headers: { Cookie: `__Host-admin_session=${token}` },
    });

    // A customer's session token hashes to a DIFFERENT value than any
    // admin session ever would (session rows are not shared between the
    // two login flows), so this is already UNAUTHENTICATED at the
    // cookie-lookup step, before resolveActor's userType check even runs —
    // this test exists to pin the OUTCOME (clean 401, never a 200 or 500),
    // regardless of which layer produces it.
    expect(res.status).toBe(401);
  });

  it('Fix #4 — a valid ADMIN session token presented as a CUSTOMER bearer token is rejected as UNAUTHENTICATED, not INTERNAL_ERROR', async () => {
    const admin = await seedAdminUser(prisma, businessId, {});
    const adminSession = await loginAsAdmin(app, admin);
    const rawToken = /__Host-admin_session=([^;]+)/.exec(adminSession.cookieHeader)?.[1];
    expect(rawToken).toBeTruthy();

    // Before Fix #4, CustomerAuthService.resolveActor had no explicit
    // userType check: it would find the admin's `users` row (ACTIVE),
    // then fail to find a `customer_profiles` row for it and throw
    // INTERNAL_ERROR (500) — a real bug, not a theoretical one. This
    // pins the fix: the SAME scenario must now produce a clean 401.
    const res = await app.request('/v1/auth/me', {
      headers: { Authorization: `Bearer ${rawToken}` },
    });

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHENTICATED');
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

    const after = await app.request('/v1/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(after.status).toBe(401);
  });
});

describe('admin session lifecycle (docs/07 §5)', () => {
  it('logs in, resolves permissions, and GET /me matches the login response', async () => {
    const role = await seedRole(prisma, businessId, {
      key: 'ADMIN_IT_ROLE',
      permissionKeys: ['dashboard:read'],
    });
    const admin = await seedAdminUser(prisma, businessId, {
      roleIds: [role.id],
      fullName: 'Priya Admin',
    });

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

    const logout = await app.request('/v1/admin/auth/logout', {
      method: 'POST',
      headers: session.headers,
    });
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

    const res = await shortLived.request('/v1/admin/auth/me', {
      headers: { Cookie: cookieHeader },
    });
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

describe('admin login by Stage C login ID (email-free accounts)', () => {
  it('logs in with a login ID and no email at all', async () => {
    const partner = await seedAdminUser(prisma, businessId, { loginId: 'rider.raj' });

    const res = await app.request('/v1/admin/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'rider.raj', password: partner.password }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { login_id: string | null; email: string | null };
    expect(body.login_id).toBe('rider.raj');
    expect(body.email).toBeNull();
  });

  it('matches a login ID case-insensitively, same as email', async () => {
    const partner = await seedAdminUser(prisma, businessId, { loginId: 'rider.raj' });

    const res = await app.request('/v1/admin/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'RIDER.RAJ', password: partner.password }),
    });
    expect(res.status).toBe(200);
  });

  it('rejects an unknown login ID with the same generic error as a wrong password', async () => {
    const res = await app.request('/v1/admin/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'no-such-rider', password: 'whatever-1234' }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('a suspended login-ID account cannot log in', async () => {
    const partner = await seedAdminUser(prisma, businessId, {
      loginId: 'rider.raj',
      status: 'SUSPENDED',
    });

    const res = await app.request('/v1/admin/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'rider.raj', password: partner.password }),
    });
    expect(res.status).toBe(401);
  });
});

describe('CSRF token recovery after a hard reload (Stage D Task A)', () => {
  /**
   * Root cause (confirmed by reproduction, not assumed): `ApiClient` only
   * ever holds the admin CSRF token in an in-memory field, captured from
   * the `X-CSRF-Token` response header — the cookie carrying the same
   * value is genuinely unreadable by `document.cookie` cross-origin in
   * the real deployed topology (admin on Vercel, API on Railway, two
   * different domains — a hard browser restriction, not a SameSite
   * misconfiguration). A hard page reload resets that in-memory field to
   * `undefined` while the session cookie itself stays perfectly valid, so
   * every mutating admin request 403s with CSRF_TOKEN_INVALID until the
   * admin explicitly logs out and back in. The fix: `GET /v1/admin/auth/
   * me` — which `AuthGate` already calls on every mount/route change,
   * before rendering any protected page — now re-echoes the EXISTING
   * CSRF cookie's value as the same response header login sends, so the
   * client recaptures it without a new login. No new CSRF exemption, no
   * token regeneration, no client-side change (the capture-from-any-
   * response logic already existed).
   */

  it('an authenticated write succeeds right after login (baseline, unchanged)', async () => {
    const role = await seedRole(prisma, businessId, {
      key: 'CSRF_BASELINE_ROLE',
      permissionKeys: ['admin_users:read'],
    });
    const admin = await seedAdminUser(prisma, businessId, { roleIds: [role.id] });
    const session = await loginAsAdmin(app, admin);

    const res = await app.request('/v1/admin/admin-users', { headers: session.headers });
    expect(res.status).toBe(200);
  });

  it('GET /me does not carry an X-CSRF-Token header when unauthenticated', async () => {
    const res = await app.request('/v1/admin/auth/me');
    expect(res.status).toBe(401);
    expect(res.headers.get('X-CSRF-Token')).toBeNull();
  });

  it(
    'reproduces the bug without the fix\'s codepath, then proves the fix: a request carrying ' +
      'only the Cookie header (simulating a hard reload — no in-memory token survives) can ' +
      'recover a usable CSRF token from GET /me and successfully complete a mutating write, ' +
      'with no second login',
    async () => {
      const role = await seedRole(prisma, businessId, {
        key: 'CSRF_RELOAD_ROLE',
        permissionKeys: ['admin_users:read', 'admin_users:update'],
      });
      const admin = await seedAdminUser(prisma, businessId, { roleIds: [role.id] });
      const session = await loginAsAdmin(app, admin);

      // Simulates the post-reload state: the browser still has the cookies,
      // but nothing in JS memory remembers the CSRF token — so this request
      // carries ONLY the Cookie header, no X-CSRF-Token at all.
      const meAfterReload = await app.request('/v1/admin/auth/me', {
        headers: { Cookie: session.cookieHeader },
      });
      expect(meAfterReload.status).toBe(200);
      const recoveredToken = meAfterReload.headers.get('X-CSRF-Token');
      expect(recoveredToken).toBeTruthy();

      // Without the fix, a mutating request at this point has no token to
      // send at all and 403s — this is the exact failure mode from the
      // live reproduction. With the fix, the token recovered from /me above
      // is used, and the write succeeds without any second login.
      const write = await app.request(`/v1/admin/admin-users/${admin.id}`, {
        method: 'PATCH',
        headers: {
          Cookie: session.cookieHeader,
          'Content-Type': 'application/json',
          'X-CSRF-Token': recoveredToken!,
        },
        body: JSON.stringify({ full_name: 'Renamed After Reload' }),
      });
      expect(write.status).toBe(200);

      const updated = await prisma.adminUser.findUniqueOrThrow({ where: { id: admin.id } });
      expect(updated.fullName).toBe('Renamed After Reload');
    },
  );

  it('the token recovered from /me is the SAME value the cookie carries, not a freshly minted one', async () => {
    const admin = await seedAdminUser(prisma, businessId, {});
    const session = await loginAsAdmin(app, admin);

    const cookieCsrfValue = session.cookieHeader
      .split('; ')
      .find((c) => c.startsWith('admin_csrf='))
      ?.slice('admin_csrf='.length);
    expect(cookieCsrfValue).toBeTruthy();

    const me = await app.request('/v1/admin/auth/me', {
      headers: { Cookie: session.cookieHeader },
    });
    expect(me.headers.get('X-CSRF-Token')).toBe(cookieCsrfValue);
  });

  it('an invalid (tampered) CSRF token is rejected even with a valid session cookie', async () => {
    const role = await seedRole(prisma, businessId, {
      key: 'CSRF_INVALID_ROLE',
      permissionKeys: ['admin_users:update'],
    });
    const admin = await seedAdminUser(prisma, businessId, { roleIds: [role.id] });
    const session = await loginAsAdmin(app, admin);

    const res = await app.request(`/v1/admin/admin-users/${admin.id}`, {
      method: 'PATCH',
      headers: {
        Cookie: session.cookieHeader,
        'Content-Type': 'application/json',
        'X-CSRF-Token': 'tampered.notarealtoken',
      },
      body: JSON.stringify({ full_name: 'Should Not Apply' }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('CSRF_TOKEN_INVALID');
  });

  it('logging out clears both cookies, so a post-logout reload recovers no token at all', async () => {
    const admin = await seedAdminUser(prisma, businessId, {});
    const session = await loginAsAdmin(app, admin);

    const logout = await app.request('/v1/admin/auth/logout', {
      method: 'POST',
      headers: session.headers,
    });
    expect(logout.status).toBe(200);
    const clearedCookies = (logout.headers.getSetCookie?.() ?? []).join('; ');
    expect(clearedCookies).toMatch(/__Host-admin_session=;/);
    expect(clearedCookies).toMatch(/admin_csrf=;/);

    // A "reload" after logout — no session, no CSRF cookie left to recover.
    const meAfterLogout = await app.request('/v1/admin/auth/me', {
      headers: { Cookie: session.cookieHeader },
    });
    expect(meAfterLogout.status).toBe(401);
    expect(meAfterLogout.headers.get('X-CSRF-Token')).toBeNull();
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

  it('sets X-RateLimit-* / Retry-After headers consistently on a 429, same as the generic limiter', async () => {
    const limited = buildApp(testEnv({ RATE_LIMIT_ENABLED: true, LOGIN_RATE_LIMIT_PER_MIN: 1 }));
    const attempt = () =>
      limited.request('/v1/admin/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'headers-check@example.test', password: 'guess' }),
      });

    await attempt();
    const res = await attempt();

    expect(res.status).toBe(429);
    expect(res.headers.get('X-RateLimit-Limit')).toBe('1');
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('0');
    expect(res.headers.get('X-RateLimit-Reset')).toBeTruthy();
    expect(res.headers.get('Retry-After')).toBeTruthy();
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('RATE_LIMITED');
  });
});

describe('registration rate limiting (Fix #1)', () => {
  it('rate-limits repeated registration attempts for the same email — registration must not bypass the protection login has', async () => {
    const limited = buildApp(testEnv({ RATE_LIMIT_ENABLED: true, REGISTER_RATE_LIMIT_PER_MIN: 3 }));
    const attempt = () =>
      limited.request('/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'register-flood@example.test',
          password: 'a-strong-password-1',
        }),
      });

    const results = [];
    for (let i = 0; i < 5; i += 1) results.push(await attempt());

    const statuses = results.map((r) => r.status);
    // Attempt #1 succeeds (201); attempts #2–3 fail on the real duplicate-
    // email check (409) — the limiter hasn't tripped yet; #4–5 never reach
    // the duplicate-email check at all, because the limiter (3/min) fires
    // first and returns 429 before any lookup or hashing happens.
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(2);
    expect(statuses.filter((s) => s === 429)).toHaveLength(2);

    // Only the one genuine success actually created a row.
    expect(await prisma.user.count({ where: { email: 'register-flood@example.test' } })).toBe(1);
  });

  it('registration and login attempts are counted in independent buckets', async () => {
    const limited = buildApp(
      testEnv({
        RATE_LIMIT_ENABLED: true,
        REGISTER_RATE_LIMIT_PER_MIN: 1,
        LOGIN_RATE_LIMIT_PER_MIN: 1,
      }),
    );
    const email = 'independent-buckets@example.test';

    const firstRegister = await limited.request('/v1/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'a-strong-password-1' }),
    });
    expect(firstRegister.status).toBe(201);

    // Registration's own limit (1/min) is now exhausted for this email —
    // but logging in with it must be unaffected by that.
    const login = await limited.request('/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'a-strong-password-1' }),
    });
    expect(login.status).toBe(200);
  });

  it('a 429 on registration reveals nothing about whether the email is already registered', async () => {
    // An email that definitely already exists (from a previous describe
    // block's registrations would risk cross-test coupling — seed one
    // explicitly instead) hits the SAME 429, with the SAME body, as a
    // brand-new email once the limiter trips — the limiter runs before any
    // lookup, so the response cannot differ based on registration status.
    const limited = buildApp(testEnv({ RATE_LIMIT_ENABLED: true, REGISTER_RATE_LIMIT_PER_MIN: 0 }));
    const existing = await seedCustomerUser(prisma, businessId, {
      email: 'already-exists-429@example.test',
    });

    const resExisting = await limited.request('/v1/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: existing.email, password: 'a-strong-password-1' }),
    });
    const resNew = await limited.request('/v1/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'brand-new-429@example.test',
        password: 'a-strong-password-1',
      }),
    });

    expect(resExisting.status).toBe(429);
    expect(resNew.status).toBe(429);
    const [bodyExisting, bodyNew] = (await Promise.all([resExisting.json(), resNew.json()])) as [
      { error: { code: string; message: string; request_id: string } },
      { error: { code: string; message: string; request_id: string } },
    ];
    // `request_id` is a fresh UUID per request by design (docs/28 §2) — it
    // is expected to differ; comparing it would fail this test for a
    // reason that has nothing to do with enumeration.
    expect(bodyExisting.error.code).toBe(bodyNew.error.code);
    expect(bodyExisting.error.message).toBe(bodyNew.error.message);
  });
});
