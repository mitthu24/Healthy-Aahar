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
import { loginAsAdmin } from './test-support/admin-session.js';
import type { AppBindings } from './types.js';

/**
 * PHASE 03 — RBAC integration tests (docs/08 §6). Exercises the real
 * `/v1/admin/admin-users` and `/v1/admin/roles` routes end to end: invite,
 * password setup, role assignment, the BR-SEC6/7/8/9 invariants, and the
 * permission enforcement middleware itself (the authorization matrix).
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
    logger: createLogger({ service: 'rbac-it', env: 'local', version: 'test', level: 'silent' }),
    businessId,
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

let superAdminHeaders: Record<string, string>;
let superAdminId: string;

beforeEach(async () => {
  await truncateAll(prisma);
  const business = await seedBusiness(prisma, { slug: 'rbac-it', name: 'Healthy Aahar' });
  businessId = business.id;
  await seedPermissions(prisma, PERMISSIONS);
  app = buildApp();

  const superAdmin = await seedAdminUser(prisma, businessId, {
    isSuperAdmin: true,
    fullName: 'Root Admin',
  });
  superAdminId = superAdmin.id;
  superAdminHeaders = (await loginAsAdmin(app, superAdmin)).headers;
});

describe('inviting staff (docs/07 §5.1 — no public sign-up)', () => {
  it('creates a user with no password, assigns roles, and audits the invite', async () => {
    const role = await seedRole(prisma, businessId, {
      key: 'INVITE_TEST_ROLE',
      permissionKeys: ['catalog:read'],
    });

    const res = await app.request('/v1/admin/admin-users', {
      method: 'POST',
      headers: superAdminHeaders,
      body: JSON.stringify({
        email: 'newstaff@example.test',
        full_name: 'New Staff',
        role_ids: [role.id],
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; roles: string[]; password_setup_link: string };
    expect(body.roles).toContain('INVITE_TEST_ROLE');
    expect(body.password_setup_link).toBeTruthy();

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'admin_user.invited', resourceId: body.id },
    });
    expect(audit).not.toBeNull();

    const invited = await prisma.user.findUniqueOrThrow({
      where: { email_userType: { email: 'newstaff@example.test', userType: 'ADMIN' } },
    });
    expect(invited.passwordHash).toBeNull();

    // The normal invite flow must NEVER set must_change_password — that's
    // reserved for a flow that hands the admin a credential someone else
    // chose/knows (the first-admin bootstrap script's temporary password).
    // An invited admin chooses their own password at setup time, so no
    // forced re-change is needed (this is the MEDIUM-finding fix: the gate
    // used to be inferred from lastPasswordChangeAt === null, which
    // incorrectly caught every admin invited this way too).
    const invitedAdmin = await prisma.adminUser.findUniqueOrThrow({ where: { id: body.id } });
    expect(invitedAdmin.mustChangePassword).toBe(false);

    // Cannot log in before completing password setup.
    const tooSoon = await app.request('/v1/admin/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'newstaff@example.test', password: 'whatever-1234' }),
    });
    expect(tooSoon.status).toBe(401);

    // Completing the setup link, end to end — this is the ONLY path an
    // invited admin has to a working credential (docs/07 §5.1).
    const token = body.password_setup_link;
    const setup = await app.request('/v1/auth/password/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password: 'a-brand-new-password-1' }),
    });
    expect(setup.status).toBe(200);

    const session = await loginAsAdmin(app, {
      email: 'newstaff@example.test',
      password: 'a-brand-new-password-1',
    });
    expect(session.headers.Cookie).toBeTruthy();

    // Not gated — reaches a protected route immediately, no forced
    // change-password detour (unlike a bootstrap-created admin).
    const me = await app.request('/v1/admin/auth/me', { headers: session.headers });
    const meBody = (await me.json()) as { must_change_password: boolean };
    expect(meBody.must_change_password).toBe(false);
  });

  it('a password-setup token cannot be reused once consumed', async () => {
    const role = await seedRole(prisma, businessId, {
      key: 'ONE_TIME_ROLE',
      permissionKeys: ['catalog:read'],
    });
    const res = await app.request('/v1/admin/admin-users', {
      method: 'POST',
      headers: superAdminHeaders,
      body: JSON.stringify({
        email: 'onetime@example.test',
        full_name: 'One Time',
        role_ids: [role.id],
      }),
    });
    const { password_setup_link: token } = (await res.json()) as { password_setup_link: string };

    const first = await app.request('/v1/auth/password/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password: 'first-password-123' }),
    });
    expect(first.status).toBe(200);

    const second = await app.request('/v1/auth/password/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password: 'second-password-456' }),
    });
    expect(second.status).toBe(401);
    const body = (await second.json()) as { error: { code: string } };
    expect(body.error.code).toBe('PASSWORD_SETUP_TOKEN_INVALID');
  });

  it('BR-SEC7 — a non-Super-Admin cannot invite a Super Admin', async () => {
    const plainRole = await seedRole(prisma, businessId, {
      key: 'PLAIN_ROLE',
      permissionKeys: ['admin_users:create'],
    });
    const plainAdmin = await seedAdminUser(prisma, businessId, { roleIds: [plainRole.id] });
    const plainHeaders = (await loginAsAdmin(app, plainAdmin)).headers;

    const superRole = await seedRole(prisma, businessId, {
      key: 'SUPER_ADMIN',
      permissionKeys: [...PERMISSIONS.map((p) => p.key)],
    });

    const res = await app.request('/v1/admin/admin-users', {
      method: 'POST',
      headers: plainHeaders,
      body: JSON.stringify({
        email: 'wannabe@example.test',
        full_name: 'Wannabe',
        role_ids: [superRole.id],
      }),
    });

    expect(res.status).toBe(403);
  });

  it('BR-SEC7 — a non-Super-Admin cannot grant roles:manage', async () => {
    const plainRole = await seedRole(prisma, businessId, {
      key: 'PLAIN_ROLE_2',
      permissionKeys: ['admin_users:create'],
    });
    const plainAdmin = await seedAdminUser(prisma, businessId, { roleIds: [plainRole.id] });
    const plainHeaders = (await loginAsAdmin(app, plainAdmin)).headers;

    const managerRole = await seedRole(prisma, businessId, {
      key: 'ROLE_MANAGER_ROLE',
      permissionKeys: ['roles:manage'],
    });

    const res = await app.request('/v1/admin/admin-users', {
      method: 'POST',
      headers: plainHeaders,
      body: JSON.stringify({
        email: 'poweruser@example.test',
        full_name: 'Power User',
        role_ids: [managerRole.id],
      }),
    });

    expect(res.status).toBe(403);
  });

  it('Fix #3 — re-inviting an already-invited email returns 409 ADMIN_ALREADY_INVITED, not a raw 500', async () => {
    const role = await seedRole(prisma, businessId, {
      key: 'DUP_INVITE_ROLE',
      permissionKeys: ['catalog:read'],
    });

    const first = await app.request('/v1/admin/admin-users', {
      method: 'POST',
      headers: superAdminHeaders,
      body: JSON.stringify({
        email: 'already-invited@example.test',
        full_name: 'First Invite',
        role_ids: [role.id],
      }),
    });
    expect(first.status).toBe(201);

    const second = await app.request('/v1/admin/admin-users', {
      method: 'POST',
      headers: superAdminHeaders,
      body: JSON.stringify({
        email: 'already-invited@example.test',
        full_name: 'Second Invite',
        role_ids: [role.id],
      }),
    });

    expect(second.status).toBe(409);
    const body = (await second.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('ADMIN_ALREADY_INVITED');
    // Not a generic/unhandled error — the response body must look like
    // every other documented error envelope, not a stack trace or a bare
    // "Something went wrong" (which is what an uncaught P2002 used to 500 as).
    expect(body.error.message).not.toMatch(/prisma|P2002|stack/i);

    // Exactly one user row exists — the failed second attempt created nothing.
    const count = await prisma.user.count({ where: { email: 'already-invited@example.test' } });
    expect(count).toBe(1);
  });

  it('Fix #3 — a duplicate ROLE ID in the SAME invite is a validation concern, not ADMIN_ALREADY_INVITED', async () => {
    // Regression guard for the narrow P2002 matcher: a caller-supplied
    // duplicate role_id collides on admin_user_roles' OWN composite primary
    // key, which is an unrelated P2002 — it must never be misreported as
    // "email already exists" (the two live in the same transaction).
    const role = await seedRole(prisma, businessId, {
      key: 'DUP_ROLE_IN_SAME_INVITE',
      permissionKeys: ['catalog:read'],
    });

    const res = await app.request('/v1/admin/admin-users', {
      method: 'POST',
      headers: superAdminHeaders,
      body: JSON.stringify({
        email: 'brand-new-not-taken@example.test',
        full_name: 'Brand New',
        role_ids: [role.id, role.id],
      }),
    });

    // Whatever this resolves to, it must NOT be mistaken for the
    // email-conflict path — assert the email really was available and is
    // not reported as taken.
    const body = (await res.json()) as { error?: { code: string } };
    expect(body.error?.code).not.toBe('ADMIN_ALREADY_INVITED');
  });
});

describe('existing-admin password reset (Fix #2)', () => {
  it('a Super Admin can issue a new setup token for an existing admin, who can then complete setup and log in', async () => {
    const role = await seedRole(prisma, businessId, {
      key: 'EXISTING_ADMIN_ROLE',
      permissionKeys: ['catalog:read'],
    });
    const existing = await seedAdminUser(prisma, businessId, {
      roleIds: [role.id],
      noPassword: true,
    });

    // Cannot log in yet — no password was ever set (simulates a
    // pre-PHASE-03 admin row, or one who never completed the invite flow).
    const tooSoon = await app.request('/v1/admin/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: existing.email, password: 'whatever-guess-1' }),
    });
    expect(tooSoon.status).toBe(401);

    const res = await app.request(`/v1/admin/admin-users/${existing.id}/reset-password`, {
      method: 'POST',
      headers: superAdminHeaders,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const { password_setup_link: token } = (await res.json()) as { password_setup_link: string };
    expect(token).toBeTruthy();

    const setup = await app.request('/v1/auth/password/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password: 'a-newly-set-password-1' }),
    });
    expect(setup.status).toBe(200);

    const session = await loginAsAdmin(app, {
      email: existing.email,
      password: 'a-newly-set-password-1',
    });
    expect(session.headers.Cookie).toBeTruthy();
  });

  it('requires admin_users:update — a plain admin without it cannot issue a reset token for another admin', async () => {
    const bareRole = await seedRole(prisma, businessId, {
      key: 'BARE_ROLE_RESET_TEST',
      permissionKeys: ['catalog:read'],
    });
    const bareAdmin = await seedAdminUser(prisma, businessId, { roleIds: [bareRole.id] });
    const bareHeaders = (await loginAsAdmin(app, bareAdmin)).headers;

    const targetRole = await seedRole(prisma, businessId, {
      key: 'RESET_TARGET_ROLE',
      permissionKeys: ['catalog:read'],
    });
    const target = await seedAdminUser(prisma, businessId, {
      roleIds: [targetRole.id],
      noPassword: true,
    });

    const res = await app.request(`/v1/admin/admin-users/${target.id}/reset-password`, {
      method: 'POST',
      headers: bareHeaders,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(403);
  });

  it('returns 404 for an unknown admin id, not a crash', async () => {
    const res = await app.request(
      '/v1/admin/admin-users/00000000-0000-7000-8000-000000000000/reset-password',
      {
        method: 'POST',
        headers: superAdminHeaders,
        body: JSON.stringify({}),
      },
    );
    expect(res.status).toBe(404);
  });
});

describe('changing roles (docs/08 §6)', () => {
  it('BR-SEC8 — an admin cannot modify their own roles', async () => {
    const role = await seedRole(prisma, businessId, {
      key: 'SELF_ROLE',
      permissionKeys: ['admin_users:update'],
    });

    const res = await app.request(`/v1/admin/admin-users/${superAdminId}/roles`, {
      method: 'POST',
      headers: superAdminHeaders,
      body: JSON.stringify({ role_ids: [role.id] }),
    });

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('CANNOT_MODIFY_OWN_ROLES');
  });

  it('BR-SEC6 — demoting the last active Super Admin is blocked', async () => {
    // Demoting yourself would ALSO be blocked by BR-SEC8 (self-modification),
    // which would prove nothing about BR-SEC6 specifically. To isolate the
    // invariant, a second super admin is created, the original is stripped
    // of super-admin status directly (bypassing the API, as a fixture would),
    // and a THIRD, unrelated actor performs the demotion of the now-only
    // Super Admin — so the 409 below can only be BR-SEC6, not BR-SEC8.
    const secondSuper = await seedAdminUser(prisma, businessId, {
      isSuperAdmin: true,
      fullName: 'Second Super',
    });
    await prisma.adminUser.update({ where: { id: superAdminId }, data: { isSuperAdmin: false } });
    await prisma.adminUserRole.deleteMany({ where: { adminUserId: superAdminId } });

    const opsRole = await seedRole(prisma, businessId, {
      key: 'OPS_ACTOR_ROLE',
      permissionKeys: ['admin_users:update'],
    });
    const opsActor = await seedAdminUser(prisma, businessId, { roleIds: [opsRole.id] });
    const opsHeaders = (await loginAsAdmin(app, opsActor)).headers;

    const plainRole = await seedRole(prisma, businessId, {
      key: 'DEMOTE_TARGET_ROLE_2',
      permissionKeys: ['catalog:read'],
    });

    const res = await app.request(`/v1/admin/admin-users/${secondSuper.id}/roles`, {
      method: 'POST',
      headers: opsHeaders,
      body: JSON.stringify({ role_ids: [plainRole.id] }),
    });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('LAST_SUPER_ADMIN');
  });
});

describe('deactivation (BR-SEC10)', () => {
  it('revokes every active session immediately and the admin can no longer authenticate', async () => {
    const role = await seedRole(prisma, businessId, {
      key: 'TO_DEACTIVATE_ROLE',
      permissionKeys: ['catalog:read'],
    });
    const target = await seedAdminUser(prisma, businessId, { roleIds: [role.id] });
    const targetSession = await loginAsAdmin(app, target);

    const res = await app.request(`/v1/admin/admin-users/${target.id}/deactivate`, {
      method: 'POST',
      headers: superAdminHeaders,
    });
    expect(res.status).toBe(200);

    // The existing session cookie must stop working immediately.
    const after = await app.request('/v1/admin/auth/me', { headers: targetSession.headers });
    expect(after.status).toBe(401);

    const sessions = await prisma.session.findMany({ where: { userId: target.userId } });
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions.every((s) => s.revokedAt !== null)).toBe(true);
  });

  it('BR-SEC6 — cannot deactivate the last active Super Admin', async () => {
    const res = await app.request(`/v1/admin/admin-users/${superAdminId}/deactivate`, {
      method: 'POST',
      headers: superAdminHeaders,
    });
    expect(res.status).toBe(409);
  });
});

describe('roles & permission catalogue', () => {
  it('rejects creating a role with an unknown permission key', async () => {
    const res = await app.request('/v1/admin/roles', {
      method: 'POST',
      headers: superAdminHeaders,
      body: JSON.stringify({
        key: 'BOGUS_ROLE',
        name: 'Bogus',
        permission_keys: ['not_a_real:permission'],
      }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('UNKNOWN_PERMISSION');
  });

  it('GET /v1/admin/permissions returns the full code-defined catalogue', async () => {
    const res = await app.request('/v1/admin/permissions', { headers: superAdminHeaders });
    const body = (await res.json()) as { data: Array<{ key: string }> };
    expect(body.data.length).toBe(PERMISSIONS.length);
    expect(body.data.map((p) => p.key)).toContain('orders:cancel');
  });
});

describe('Phase 05 — employee details, reactivation, self-deactivation guard', () => {
  it('GET a single admin and PATCH their name/designation/department, never touching roles', async () => {
    const role = await seedRole(prisma, businessId, {
      key: 'DETAILS_ROLE',
      permissionKeys: ['catalog:read'],
    });
    const target = await seedAdminUser(prisma, businessId, {
      roleIds: [role.id],
      fullName: 'Original Name',
    });

    const single = await app.request(`/v1/admin/admin-users/${target.id}`, {
      headers: superAdminHeaders,
    });
    expect(single.status).toBe(200);
    const singleBody = (await single.json()) as { full_name: string };
    expect(singleBody.full_name).toBe('Original Name');

    const patch = await app.request(`/v1/admin/admin-users/${target.id}`, {
      method: 'PATCH',
      headers: superAdminHeaders,
      body: JSON.stringify({
        full_name: 'Updated Name',
        designation: 'Ops Lead',
        department: 'Operations',
      }),
    });
    expect(patch.status).toBe(200);
    const patched = (await patch.json()) as {
      full_name: string;
      designation: string;
      department: string;
      roles: string[];
    };
    expect(patched.full_name).toBe('Updated Name');
    expect(patched.designation).toBe('Ops Lead');
    expect(patched.department).toBe('Operations');
    expect(patched.roles).toEqual(['DETAILS_ROLE']); // untouched by the details update

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'admin_user.updated', resourceId: target.id },
    });
    expect(audit).not.toBeNull();
  });

  it('404s GET/PATCH for an unknown admin id', async () => {
    const unknownId = '00000000-0000-7000-8000-000000000000';
    const getRes = await app.request(`/v1/admin/admin-users/${unknownId}`, {
      headers: superAdminHeaders,
    });
    expect(getRes.status).toBe(404);

    const patchRes = await app.request(`/v1/admin/admin-users/${unknownId}`, {
      method: 'PATCH',
      headers: superAdminHeaders,
      body: JSON.stringify({ full_name: 'X' }),
    });
    expect(patchRes.status).toBe(404);
  });

  it('a Super Admin cannot deactivate their own account', async () => {
    const res = await app.request(`/v1/admin/admin-users/${superAdminId}/deactivate`, {
      method: 'POST',
      headers: superAdminHeaders,
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('CANNOT_DEACTIVATE_SELF');
  });

  it('a role change revokes the target\'s existing sessions', async () => {
    const roleA = await seedRole(prisma, businessId, {
      key: 'ROLE_CHANGE_A',
      permissionKeys: ['catalog:read'],
    });
    const roleB = await seedRole(prisma, businessId, {
      key: 'ROLE_CHANGE_B',
      permissionKeys: ['orders:read'],
    });
    const target = await seedAdminUser(prisma, businessId, { roleIds: [roleA.id] });
    const targetSession = await loginAsAdmin(app, target);

    const res = await app.request(`/v1/admin/admin-users/${target.id}/roles`, {
      method: 'POST',
      headers: superAdminHeaders,
      body: JSON.stringify({ role_ids: [roleB.id] }),
    });
    expect(res.status).toBe(200);

    const after = await app.request('/v1/admin/auth/me', { headers: targetSession.headers });
    expect(after.status).toBe(401);
  });

  it('reactivates a deactivated account, which can then log in again', async () => {
    const role = await seedRole(prisma, businessId, {
      key: 'REACTIVATE_ROLE',
      permissionKeys: ['catalog:read'],
    });
    const target = await seedAdminUser(prisma, businessId, { roleIds: [role.id] });

    const deactivateRes = await app.request(`/v1/admin/admin-users/${target.id}/deactivate`, {
      method: 'POST',
      headers: superAdminHeaders,
    });
    expect(deactivateRes.status).toBe(200);

    const loginWhileDeactivated = await app.request('/v1/admin/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: target.email, password: target.password }),
    });
    expect(loginWhileDeactivated.status).toBe(401);

    const reactivateRes = await app.request(`/v1/admin/admin-users/${target.id}/reactivate`, {
      method: 'POST',
      headers: superAdminHeaders,
    });
    expect(reactivateRes.status).toBe(200);
    const reactivated = (await reactivateRes.json()) as { deactivated: boolean };
    expect(reactivated.deactivated).toBe(false);

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'admin_user.reactivated', resourceId: target.id },
    });
    expect(audit).not.toBeNull();

    const session = await loginAsAdmin(app, target);
    expect(session.headers.Cookie).toBeTruthy();
  });

  it('refuses to reactivate an account that is already active', async () => {
    const role = await seedRole(prisma, businessId, {
      key: 'ALREADY_ACTIVE_ROLE',
      permissionKeys: ['catalog:read'],
    });
    const target = await seedAdminUser(prisma, businessId, { roleIds: [role.id] });

    const res = await app.request(`/v1/admin/admin-users/${target.id}/reactivate`, {
      method: 'POST',
      headers: superAdminHeaders,
    });
    expect(res.status).toBe(422);
  });

  it('search by name/email filters the list', async () => {
    const role = await seedRole(prisma, businessId, {
      key: 'SEARCH_ROLE',
      permissionKeys: ['catalog:read'],
    });
    await seedAdminUser(prisma, businessId, {
      roleIds: [role.id],
      fullName: 'Findable Fiona',
      email: 'fiona-search@example.test',
    });
    await seedAdminUser(prisma, businessId, { roleIds: [role.id], fullName: 'Someone Else' });

    const res = await app.request('/v1/admin/admin-users?q=Fiona', { headers: superAdminHeaders });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ full_name: string }> };
    expect(body.data.some((a) => a.full_name === 'Findable Fiona')).toBe(true);
    expect(body.data.some((a) => a.full_name === 'Someone Else')).toBe(false);
  });
});

describe('Phase 05 — audit log read path', () => {
  it('requires audit:read — forbidden without it, even for an otherwise-privileged admin', async () => {
    const role = await seedRole(prisma, businessId, {
      key: 'NO_AUDIT_ROLE',
      permissionKeys: ['admin_users:read', 'admin_users:update', 'roles:read'],
    });
    const admin = await seedAdminUser(prisma, businessId, { roleIds: [role.id] });
    const headers = (await loginAsAdmin(app, admin)).headers;

    const res = await app.request('/v1/admin/audit-log', { headers });
    expect(res.status).toBe(403);
  });

  it('lists recent events with audit:read, newest first, and filters by action', async () => {
    const role = await seedRole(prisma, businessId, {
      key: 'AUDIT_READER',
      permissionKeys: ['catalog:read'],
    });
    const target = await seedAdminUser(prisma, businessId, { roleIds: [role.id] });

    // Generate a real audited event to search for.
    await app.request(`/v1/admin/admin-users/${target.id}/deactivate`, {
      method: 'POST',
      headers: superAdminHeaders,
    });

    const auditRole = await seedRole(prisma, businessId, {
      key: 'AUDIT_ONLY',
      permissionKeys: ['audit:read'],
    });
    const auditAdmin = await seedAdminUser(prisma, businessId, { roleIds: [auditRole.id] });
    const auditHeaders = (await loginAsAdmin(app, auditAdmin)).headers;

    const res = await app.request(
      '/v1/admin/audit-log?action=admin_user.deactivated',
      { headers: auditHeaders },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ action: string; resource_id: string | null }>;
      pagination: { limit: number; has_more: boolean };
    };
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data.every((e) => e.action === 'admin_user.deactivated')).toBe(true);
    expect(body.data.some((e) => e.resource_id === target.id)).toBe(true);
  });

  it('does not leak another business\'s audit entries', async () => {
    const otherBusiness = await seedBusiness(prisma, {
      slug: 'rbac-it-other',
      name: 'Rival Foods',
    });
    await seedPermissions(prisma, PERMISSIONS);
    const otherRole = await seedRole(prisma, otherBusiness.id, {
      key: 'OTHER_BIZ_ROLE',
      permissionKeys: ['catalog:read'],
    });
    const otherTarget = await seedAdminUser(prisma, otherBusiness.id, {
      roleIds: [otherRole.id],
    });
    const otherSuperRole = await seedRole(prisma, otherBusiness.id, {
      key: 'OTHER_BIZ_SUPER',
      permissionKeys: [...PERMISSIONS.map((p) => p.key)],
    });
    const otherSuper = await seedAdminUser(prisma, otherBusiness.id, {
      roleIds: [otherSuperRole.id],
    });

    // An event in the OTHER business — the session must be established
    // against an app instance SCOPED to that business, or admin-auth
    // resolves the actor against the wrong tenant entirely.
    const otherApp = createApp({
      env: testEnv(),
      prisma,
      logger: createLogger({ service: 'rbac-it', env: 'local', version: 'test', level: 'silent' }),
      businessId: otherBusiness.id,
    });
    const otherSuperHeaders = (await loginAsAdmin(otherApp, otherSuper)).headers;
    await otherApp.request(`/v1/admin/admin-users/${otherTarget.id}/deactivate`, {
      method: 'POST',
      headers: otherSuperHeaders,
    });

    // This business's audit:read admin must not see it.
    const auditRole = await seedRole(prisma, businessId, {
      key: 'ISOLATION_AUDIT_ROLE',
      permissionKeys: ['audit:read'],
    });
    const auditAdmin = await seedAdminUser(prisma, businessId, { roleIds: [auditRole.id] });
    const auditHeaders = (await loginAsAdmin(app, auditAdmin)).headers;

    const res = await app.request('/v1/admin/audit-log?action=admin_user.deactivated', {
      headers: auditHeaders,
    });
    const body = (await res.json()) as { data: Array<{ resource_id: string | null }> };
    expect(body.data.some((e) => e.resource_id === otherTarget.id)).toBe(false);
  });
});

describe('authorization matrix (docs/08 §5.1 — the only enforcement that is security)', () => {
  it('an admin holding an UNRELATED permission is forbidden — deny by default, not "any role passes"', async () => {
    const role = await seedRole(prisma, businessId, {
      key: 'MATRIX_UNRELATED',
      permissionKeys: ['notifications:send'],
    });
    const admin = await seedAdminUser(prisma, businessId, { roleIds: [role.id] });
    const headers = (await loginAsAdmin(app, admin)).headers;

    const res = await app.request('/v1/admin/cities', { headers });
    expect(res.status).toBe(403);
  });

  it('granting the exact permission unblocks the exact route', async () => {
    const role = await seedRole(prisma, businessId, {
      key: 'READ_ONLY_DELIVERY',
      permissionKeys: ['delivery:read'],
    });
    const admin = await seedAdminUser(prisma, businessId, { roleIds: [role.id] });
    const headers = (await loginAsAdmin(app, admin)).headers;

    const res = await app.request('/v1/admin/cities', { headers });
    expect(res.status).toBe(200);
  });
});
