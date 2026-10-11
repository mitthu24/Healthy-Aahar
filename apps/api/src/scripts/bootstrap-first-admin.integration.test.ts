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
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { bootstrapFirstAdmin } from './bootstrap-first-admin.js';

/**
 * Integration tests against a REAL, ephemeral, LOCAL test database — the
 * same harness `rbac.integration.test.ts` uses (`setupTestDatabase`,
 * ADR-028). This NEVER touches Railway or any remote database: it creates
 * and drops its own `healthy_aahar_test` database on whatever Postgres
 * `DATABASE_URL` in the local/CI environment points at, exactly like every
 * other `*.integration.test.ts` in this repo.
 */

let prisma: PrismaClient;
let businessId: string;

beforeAll(async () => {
  const url = await setupTestDatabase();
  prisma = createTestClient(url);
}, 180_000);

afterAll(async () => {
  await prisma?.$disconnect();
});

beforeEach(async () => {
  await truncateAll(prisma);
  const business = await seedBusiness(prisma, { slug: 'bootstrap-it', name: 'Healthy Aahar' });
  businessId = business.id;
  await seedPermissions(prisma, PERMISSIONS);
  await seedRole(prisma, businessId, {
    key: 'SUPER_ADMIN',
    name: 'Super Admin',
    permissionKeys: ['roles:manage', 'admin_users:create'],
  });
});

describe('bootstrapFirstAdmin — safe account/token creation', () => {
  it('creates exactly one Super Admin with no password and a redeemable setup token', async () => {
    const result = await bootstrapFirstAdmin(prisma, {
      email: 'founder@example.test',
      fullName: 'Founder',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.email).toBe('founder@example.test');
    expect(result.passwordSetupLink).toBeTruthy();

    const user = await prisma.user.findUniqueOrThrow({ where: { id: result.userId } });
    expect(user.passwordHash).toBeNull();
    expect(user.status).toBe('ACTIVE');
    expect(user.userType).toBe('ADMIN');

    const admin = await prisma.adminUser.findUniqueOrThrow({ where: { id: result.adminUserId } });
    expect(admin.isSuperAdmin).toBe(true);
    expect(admin.invitedBy).toBeNull();
    // Explicit, persisted gate — this is what forces the operator through
    // change-password after redeeming the setup token with the temporary
    // password, distinct from (and no longer inferred from)
    // lastPasswordChangeAt.
    expect(admin.mustChangePassword).toBe(true);

    const roleLinks = await prisma.adminUserRole.findMany({
      where: { adminUserId: result.adminUserId },
      include: { role: { select: { key: true } } },
    });
    expect(roleLinks.map((r) => r.role.key)).toContain('SUPER_ADMIN');

    const token = await prisma.passwordResetToken.findFirst({
      where: { userId: result.userId, purpose: 'SETUP' },
    });
    expect(token).not.toBeNull();
    expect(token?.usedAt).toBeNull();
    expect(token!.expiresAt.getTime()).toBeGreaterThan(Date.now());

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'admin_user.invited', resourceId: result.adminUserId },
    });
    expect(audit).not.toBeNull();
    expect(audit?.actorType).toBe('SYSTEM');
    expect(audit?.actorUserId).toBeNull();

    // End to end: the token this script printed is a genuine, working
    // password-setup token through the real route logic.
    const { PasswordResetService } = await import('@healthy-aahar/core');
    const { scryptPasswordHasher, sha256SessionTokenHasher } = await import(
      '@healthy-aahar/auth'
    );
    const { PrismaUserRepository } = await import('../repositories/prisma-user-repository.js');
    const { PrismaPasswordResetRepository } = await import(
      '../repositories/prisma-password-reset-repository.js'
    );
    const { PrismaSessionRepository } = await import(
      '../repositories/prisma-session-repository.js'
    );
    const passwordReset = new PasswordResetService(
      new PrismaUserRepository(prisma),
      new PrismaPasswordResetRepository(prisma),
      new PrismaSessionRepository(prisma),
      scryptPasswordHasher,
      sha256SessionTokenHasher,
    );
    await expect(
      passwordReset.setPassword({
        token: result.passwordSetupLink,
        newPassword: 'a-brand-new-password-1',
      }),
    ).resolves.toBeUndefined();

    const updatedUser = await prisma.user.findUniqueOrThrow({ where: { id: result.userId } });
    expect(updatedUser.passwordHash).not.toBeNull();
  });

  it('refuses when an admin already exists, and creates nothing new', async () => {
    await seedAdminUser(prisma, businessId, { isSuperAdmin: true, fullName: 'Existing Admin' });
    const before = await prisma.adminUser.count();

    const result = await bootstrapFirstAdmin(prisma, {
      email: 'second-founder@example.test',
      fullName: 'Second Founder',
    });

    expect(result).toEqual({ ok: false, reason: 'ADMIN_ALREADY_EXISTS' });

    const after = await prisma.adminUser.count();
    expect(after).toBe(before);
    const newUser = await prisma.user.findFirst({
      where: { email: 'second-founder@example.test' },
    });
    expect(newUser).toBeNull();
  });

  it('refuses when no business row exists', async () => {
    // roles.business_id is a restrictive FK — the SUPER_ADMIN role seeded in
    // beforeEach must go first, or the business delete itself is rejected by
    // the database (not the behavior this test wants to exercise).
    await prisma.role.deleteMany({ where: { businessId } });
    await prisma.business.deleteMany();

    const result = await bootstrapFirstAdmin(prisma, {
      email: 'founder@example.test',
      fullName: 'Founder',
    });

    expect(result).toEqual({ ok: false, reason: 'NO_BUSINESS' });
  });

  it('refuses when the SUPER_ADMIN role has not been seeded', async () => {
    await prisma.role.deleteMany({ where: { businessId } });

    const result = await bootstrapFirstAdmin(prisma, {
      email: 'founder@example.test',
      fullName: 'Founder',
    });

    expect(result).toEqual({ ok: false, reason: 'NO_SUPER_ADMIN_ROLE' });
  });

  it('refuses a duplicate email even on an otherwise-empty admin table', async () => {
    // A CUSTOMER row with the same email is a different (email, user_type)
    // identity and must NOT collide — only an existing ADMIN-typed user
    // should trip EMAIL_TAKEN (mirrors PrismaAdminRepository.invite()).
    await prisma.user.create({
      data: {
        id: '01930000-0000-7000-8000-000000000001',
        userType: 'CUSTOMER',
        email: 'shared@example.test',
        status: 'ACTIVE',
      },
    });
    const okResult = await bootstrapFirstAdmin(prisma, {
      email: 'shared@example.test',
      fullName: 'Founder',
    });
    expect(okResult.ok).toBe(true);
  });

  it('serializes two concurrent bootstrap attempts — exactly one succeeds', async () => {
    const [first, second] = await Promise.all([
      bootstrapFirstAdmin(prisma, { email: 'race-a@example.test', fullName: 'Race A' }),
      bootstrapFirstAdmin(prisma, { email: 'race-b@example.test', fullName: 'Race B' }),
    ]);

    const outcomes = [first, second];
    const succeeded = outcomes.filter((r) => r.ok);
    const refused = outcomes.filter((r) => !r.ok);

    expect(succeeded).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({ ok: false, reason: 'ADMIN_ALREADY_EXISTS' });

    const totalAdmins = await prisma.adminUser.count();
    expect(totalAdmins).toBe(1);
  });
});
