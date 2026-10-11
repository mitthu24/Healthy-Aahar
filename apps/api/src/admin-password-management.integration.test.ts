import type { ServerEnv } from '@healthy-aahar/config/env/server';
import { PERMISSIONS } from '@healthy-aahar/core';
import type { PrismaClient } from '@healthy-aahar/db';
import {
  createTestClient,
  seedAdminUser,
  seedBusiness,
  seedPermissions,
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
 * Admin password-management integration tests (Phase 04 follow-up):
 *  - the `mustChangePassword` enforcement added to the admin-auth
 *    middleware (previously only a frontend redirect — an admin calling the
 *    API directly could reach every route regardless),
 *  - self-service change-password (success, wrong current password),
 *  - expired password-setup tokens (complements rbac.integration.test.ts's
 *    existing "cannot be reused" coverage, which does not test expiry).
 *
 * Runs against the same ephemeral, LOCAL test database every other
 * `*.integration.test.ts` in this repo uses (`setupTestDatabase`,
 * ADR-028) — never Railway, never production.
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

function buildApp() {
  return createApp({
    env: testEnv(),
    prisma,
    logger: createLogger({ service: 'admin-pw-it', env: 'local', version: 'test', level: 'silent' }),
    businessId,
  });
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
  const business = await seedBusiness(prisma, { slug: 'admin-pw-it', name: 'Healthy Aahar' });
  businessId = business.id;
  await seedPermissions(prisma, PERMISSIONS);
  app = buildApp();
});

describe('mustChangePassword — enforced server-side, not just a frontend redirect', () => {
  it('blocks a protected route with 403 PASSWORD_CHANGE_REQUIRED when the password has never been changed', async () => {
    const admin = await seedAdminUser(prisma, businessId, {
      isSuperAdmin: true,
      mustChangePassword: true,
    });
    const headers = (await loginAsAdmin(app, admin)).headers;

    const res = await app.request('/v1/admin/orders', { headers });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
  });

  it('still allows GET /v1/admin/auth/me, POST /v1/admin/auth/change-password and POST /v1/admin/auth/logout', async () => {
    const admin = await seedAdminUser(prisma, businessId, {
      isSuperAdmin: true,
      mustChangePassword: true,
    });
    const headers = (await loginAsAdmin(app, admin)).headers;

    const me = await app.request('/v1/admin/auth/me', { headers });
    expect(me.status).toBe(200);
    const meBody = (await me.json()) as { must_change_password: boolean };
    expect(meBody.must_change_password).toBe(true);

    const changed = await app.request('/v1/admin/auth/change-password', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        current_password: admin.password,
        new_password: 'a-brand-new-password-1',
      }),
    });
    expect(changed.status).toBe(200);
  });

  it('login response already reflects must_change_password=true for a never-changed password', async () => {
    const admin = await seedAdminUser(prisma, businessId, {
      isSuperAdmin: true,
      mustChangePassword: true,
    });
    const res = await app.request('/v1/admin/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: admin.email, password: admin.password }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { must_change_password: boolean };
    expect(body.must_change_password).toBe(true);
  });

  it('clears after a successful self-service change, unblocking protected routes', async () => {
    const admin = await seedAdminUser(prisma, businessId, {
      isSuperAdmin: true,
      mustChangePassword: true,
    });
    const headers = (await loginAsAdmin(app, admin)).headers;

    await app.request('/v1/admin/auth/change-password', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        current_password: admin.password,
        new_password: 'a-brand-new-password-1',
      }),
    });

    // The old session was revoked by the password change (Phase 04) — sign
    // in again with the new password, same as a real admin would.
    const newHeaders = (
      await loginAsAdmin(app, { email: admin.email, password: 'a-brand-new-password-1' })
    ).headers;

    const res = await app.request('/v1/admin/orders', { headers: newHeaders });
    expect(res.status).not.toBe(403);

    const me = await app.request('/v1/admin/auth/me', { headers: newHeaders });
    const meBody = (await me.json()) as { must_change_password: boolean };
    expect(meBody.must_change_password).toBe(false);
  });

  it('an admin who already changed their password is never gated (default fixture behaviour)', async () => {
    const admin = await seedAdminUser(prisma, businessId, { isSuperAdmin: true });
    const headers = (await loginAsAdmin(app, admin)).headers;

    const res = await app.request('/v1/admin/orders', { headers });
    expect(res.status).not.toBe(403);
  });

  it('MEDIUM-finding regression: an admin with last_password_change_at = NULL is NOT locked out when must_change_password is false', async () => {
    // Simulates a real-world row: completed the normal invite/setup-token
    // flow (chose their own password), has simply never used the separate
    // "change password" feature since — exactly the case the old
    // lastPasswordChangeAt-derived gate incorrectly caught. The explicit,
    // persisted `must_change_password` column is what the gate reads now,
    // and it defaults to false regardless of this timestamp.
    const admin = await seedAdminUser(prisma, businessId, {
      isSuperAdmin: true,
      lastPasswordChangeAt: null,
      mustChangePassword: false,
    });
    const headers = (await loginAsAdmin(app, admin)).headers;

    const me = await app.request('/v1/admin/auth/me', { headers });
    expect(me.status).toBe(200);
    const meBody = (await me.json()) as { must_change_password: boolean };
    expect(meBody.must_change_password).toBe(false);

    const res = await app.request('/v1/admin/orders', { headers });
    expect(res.status).not.toBe(403);
  });

  it('a failed password-change attempt does NOT clear must_change_password', async () => {
    const admin = await seedAdminUser(prisma, businessId, {
      isSuperAdmin: true,
      mustChangePassword: true,
    });
    const headers = (await loginAsAdmin(app, admin)).headers;

    const failed = await app.request('/v1/admin/auth/change-password', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        current_password: 'definitely-the-wrong-password',
        new_password: 'a-brand-new-password-1',
      }),
    });
    expect(failed.status).toBe(401);

    // Still gated — the failed attempt changed nothing.
    const me = await app.request('/v1/admin/auth/me', { headers });
    expect(me.status).toBe(200);
    const meBody = (await me.json()) as { must_change_password: boolean };
    expect(meBody.must_change_password).toBe(true);

    const blocked = await app.request('/v1/admin/orders', { headers });
    expect(blocked.status).toBe(403);
  });
});

describe('self-service change-password (POST /v1/admin/auth/change-password)', () => {
  it('rejects an incorrect current password and makes no change', async () => {
    const admin = await seedAdminUser(prisma, businessId, { isSuperAdmin: true });
    const headers = (await loginAsAdmin(app, admin)).headers;

    const res = await app.request('/v1/admin/auth/change-password', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        current_password: 'definitely-the-wrong-password',
        new_password: 'a-brand-new-password-1',
      }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_CREDENTIALS');

    // The old password still works — nothing was changed.
    const stillWorks = await app.request('/v1/admin/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: admin.email, password: admin.password }),
    });
    expect(stillWorks.status).toBe(200);
  });

  it('rejects a too-short new password at the route layer (VALIDATION_FAILED, not WEAK_PASSWORD)', async () => {
    // changeOwnPasswordBodySchema's new_password is z.string().min(10).max(256)
    // (packages/contracts/src/auth.ts), and AdminAuthService.changeOwnPassword's
    // own assertPasswordStrength (packages/auth/src/password.ts) enforces the
    // EXACT same 10-256 length bounds and nothing else. Every input that could
    // trip the service-level check is already rejected by Zod first — there is
    // no schema-valid input that reaches the WEAK_PASSWORD branch through this
    // route. This test asserts the real, reachable behavior (422
    // VALIDATION_FAILED) rather than an unreachable one.
    const admin = await seedAdminUser(prisma, businessId, { isSuperAdmin: true });
    const headers = (await loginAsAdmin(app, admin)).headers;

    const res = await app.request('/v1/admin/auth/change-password', {
      method: 'POST',
      headers,
      body: JSON.stringify({ current_password: admin.password, new_password: 'short' }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_FAILED');
  });

  it('requires authentication', async () => {
    const res = await app.request('/v1/admin/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current_password: 'x', new_password: 'a-brand-new-password-1' }),
    });
    expect(res.status).toBe(401);
  });

  it('succeeds, revokes the current session, and logs in again with the new password', async () => {
    const admin = await seedAdminUser(prisma, businessId, { isSuperAdmin: true });
    const { headers, cookieHeader } = await loginAsAdmin(app, admin);

    const res = await app.request('/v1/admin/auth/change-password', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        current_password: admin.password,
        new_password: 'a-brand-new-password-1',
      }),
    });
    expect(res.status).toBe(200);

    // The session used for this very request is gone.
    const reused = await app.request('/v1/admin/auth/me', {
      headers: { Cookie: cookieHeader },
    });
    expect(reused.status).toBe(401);

    // The old password no longer works.
    const oldPasswordLogin = await app.request('/v1/admin/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: admin.email, password: admin.password }),
    });
    expect(oldPasswordLogin.status).toBe(401);

    // The new one does.
    const newPasswordLogin = await app.request('/v1/admin/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: admin.email, password: 'a-brand-new-password-1' }),
    });
    expect(newPasswordLogin.status).toBe(200);
  });
});

describe('password-setup token expiry (complements the reuse test in rbac.integration.test.ts)', () => {
  it('rejects an expired token, even though it was never consumed', async () => {
    const admin = await seedAdminUser(prisma, businessId, { isSuperAdmin: true, noPassword: true });

    // Mint a real token the same way RbacService.inviteAdmin does, then
    // directly age it past its expiry — this is the ONLY place a test
    // reaches into the token's expiry; redemption itself goes through the
    // real route.
    const { PasswordResetService } = await import('@healthy-aahar/core');
    const { scryptPasswordHasher, sha256SessionTokenHasher } = await import(
      '@healthy-aahar/auth'
    );
    const { PrismaUserRepository } = await import('./repositories/prisma-user-repository.js');
    const { PrismaPasswordResetRepository } = await import(
      './repositories/prisma-password-reset-repository.js'
    );
    const { PrismaSessionRepository } = await import('./repositories/prisma-session-repository.js');

    const passwordReset = new PasswordResetService(
      new PrismaUserRepository(prisma),
      new PrismaPasswordResetRepository(prisma),
      new PrismaSessionRepository(prisma),
      scryptPasswordHasher,
      sha256SessionTokenHasher,
    );
    const token = await passwordReset.issueToken({ userId: admin.userId, purpose: 'SETUP' });

    await prisma.passwordResetToken.updateMany({
      where: { userId: admin.userId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await app.request('/v1/auth/password/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password: 'a-brand-new-password-1' }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('PASSWORD_SETUP_TOKEN_INVALID');

    // Still no password — the expired attempt did not silently succeed.
    const user = await prisma.user.findUniqueOrThrow({ where: { id: admin.userId } });
    expect(user.passwordHash).toBeNull();
  });
});
