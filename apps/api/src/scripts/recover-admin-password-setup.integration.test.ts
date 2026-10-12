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

import { recoverAdminPasswordSetup } from './recover-admin-password-setup.js';

/**
 * Integration tests against a REAL, ephemeral, LOCAL test database — the
 * same harness `bootstrap-first-admin.integration.test.ts` uses
 * (`setupTestDatabase`, ADR-028). This NEVER touches Railway or any remote
 * database.
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
  const business = await seedBusiness(prisma, { slug: 'recover-it', name: 'Healthy Aahar' });
  businessId = business.id;
  await seedPermissions(prisma, PERMISSIONS);
  await seedRole(prisma, businessId, {
    key: 'SUPER_ADMIN',
    name: 'Super Admin',
    permissionKeys: ['roles:manage', 'admin_users:create'],
  });
});

describe('recoverAdminPasswordSetup — finds the existing Super Admin, never creates one', () => {
  it('issues a redeemable setup link for the existing Super Admin, with no new user/admin row', async () => {
    const seeded = await seedAdminUser(prisma, businessId, {
      email: 'admin@gmail.com',
      isSuperAdmin: true,
      fullName: 'Healthy Aahar Admin',
      noPassword: true,
      mustChangePassword: true,
    });
    const adminCountBefore = await prisma.adminUser.count();
    const userCountBefore = await prisma.user.count();

    const result = await recoverAdminPasswordSetup(prisma, { email: 'admin@gmail.com' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.email).toBe('admin@gmail.com');
    expect(result.passwordSetupLink).toBeTruthy();

    expect(await prisma.adminUser.count()).toBe(adminCountBefore);
    expect(await prisma.user.count()).toBe(userCountBefore);

    const token = await prisma.passwordResetToken.findFirst({
      where: { userId: seeded.userId, purpose: 'RESET' },
    });
    expect(token).not.toBeNull();
    expect(token?.usedAt).toBeNull();
    expect(token!.expiresAt.getTime()).toBeGreaterThan(Date.now());

    // End to end: the token this script printed is a genuine, working
    // password-setup token through the real route logic.
    const { PasswordResetService } = await import('@healthy-aahar/core');
    const { scryptPasswordHasher, sha256SessionTokenHasher } = await import('@healthy-aahar/auth');
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

    const updatedUser = await prisma.user.findUniqueOrThrow({ where: { id: seeded.userId } });
    expect(updatedUser.passwordHash).not.toBeNull();
  });

  it('refuses when no admin exists for the business', async () => {
    const result = await recoverAdminPasswordSetup(prisma, { email: 'admin@gmail.com' });
    expect(result).toEqual({
      ok: false,
      reason: 'AMBIGUOUS_SUPER_ADMIN_COUNT',
      activeSuperAdminCount: 0,
    });
  });

  it('refuses when more than one active Super Admin exists, even if the email matches one of them', async () => {
    await seedAdminUser(prisma, businessId, {
      email: 'admin@gmail.com',
      isSuperAdmin: true,
      fullName: 'First',
    });
    await seedAdminUser(prisma, businessId, {
      email: 'second-super-admin@example.test',
      isSuperAdmin: true,
      fullName: 'Second',
    });

    const result = await recoverAdminPasswordSetup(prisma, { email: 'admin@gmail.com' });
    expect(result).toEqual({
      ok: false,
      reason: 'AMBIGUOUS_SUPER_ADMIN_COUNT',
      activeSuperAdminCount: 2,
    });
  });

  it('refuses when the email does not match the existing Super Admin', async () => {
    await seedAdminUser(prisma, businessId, {
      email: 'admin@gmail.com',
      isSuperAdmin: true,
      fullName: 'Healthy Aahar Admin',
    });

    const result = await recoverAdminPasswordSetup(prisma, {
      email: 'someone-else@example.test',
    });
    expect(result).toEqual({ ok: false, reason: 'ADMIN_NOT_FOUND' });
  });

  it('refuses when the sole active admin is not a Super Admin', async () => {
    await seedAdminUser(prisma, businessId, {
      email: 'admin@gmail.com',
      isSuperAdmin: false,
      fullName: 'Non-Super Admin',
    });

    const result = await recoverAdminPasswordSetup(prisma, { email: 'admin@gmail.com' });
    // Not counted by countActiveSuperAdmins at all (isSuperAdmin: false), so
    // this surfaces as the same "no active Super Admin to recover" refusal.
    expect(result).toEqual({
      ok: false,
      reason: 'AMBIGUOUS_SUPER_ADMIN_COUNT',
      activeSuperAdminCount: 0,
    });
  });

  it('refuses when the matching account is suspended', async () => {
    // A suspended admin is excluded from countActiveSuperAdmins, so with no
    // OTHER active Super Admin this is indistinguishable from "none exist"
    // — refusing via the same ambiguity guard, never by quietly reactivating
    // or resetting a suspended account.
    await seedAdminUser(prisma, businessId, {
      email: 'admin@gmail.com',
      isSuperAdmin: true,
      fullName: 'Suspended Admin',
      status: 'SUSPENDED',
    });

    const result = await recoverAdminPasswordSetup(prisma, { email: 'admin@gmail.com' });
    expect(result).toEqual({
      ok: false,
      reason: 'AMBIGUOUS_SUPER_ADMIN_COUNT',
      activeSuperAdminCount: 0,
    });
  });

  it('refuses when no business row exists', async () => {
    await prisma.role.deleteMany({ where: { businessId } });
    await prisma.business.deleteMany();

    const result = await recoverAdminPasswordSetup(prisma, { email: 'admin@gmail.com' });
    expect(result).toEqual({ ok: false, reason: 'NO_BUSINESS' });
  });
});
