import { execSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { hashPassword } from '@healthy-aahar/auth';
import { PrismaClient } from '@prisma/client';
import { v7 as uuidv7 } from 'uuid';

/**
 * Integration-test harness.
 *
 * Tests run against a REAL PostgreSQL, not a mock. The invariants this system
 * depends on — over-booking, negative stock, duplicate subscription
 * deliveries, cross-business leakage — are enforced by CHECK constraints,
 * partial unique indexes and row locks. A mocked database proves nothing
 * about any of them (docs/24 §2.3).
 *
 * A dedicated database is provisioned per run rather than using
 * Testcontainers: CI already provisions a PostgreSQL service container, and a
 * separate database on it gives identical isolation without paying ~30s of
 * container startup on every run (ADR-028).
 *
 * This file is TEST INFRASTRUCTURE, not application code. Fixtures read the
 * wall clock directly because there is no Clock to inject into a fixture and
 * no cutoff arithmetic to keep testable — the application-code rule
 * (ADR-007) is about business logic, which none of this is.
 */
/* eslint-disable no-restricted-syntax */

const TEST_DB_NAME = 'healthy_aahar_test';

function adminUrl(base: string): string {
  const url = new URL(base);
  url.pathname = '/postgres';
  return url.toString();
}

function testUrl(base: string): string {
  const url = new URL(base);
  url.pathname = `/${TEST_DB_NAME}`;
  return url.toString();
}

export function resolveTestDatabaseUrl(): string {
  const base = process.env.DATABASE_URL;
  if (!base) {
    throw new Error('DATABASE_URL must be set to run integration tests.');
  }
  return testUrl(base);
}

/**
 * Create the test database and apply all migrations.
 *
 * Migrations are applied rather than `db push` so the tests exercise exactly
 * the SQL that will run in production — including the hand-written CHECK
 * constraints and triggers that Prisma's schema cannot express.
 */
export async function setupTestDatabase(): Promise<string> {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error('DATABASE_URL must be set to run integration tests.');

  const admin = new PrismaClient({ datasources: { db: { url: adminUrl(base) } } });

  try {
    // Terminate stragglers so DROP cannot block on a leaked connection.
    await admin.$executeRawUnsafe(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
       WHERE datname = '${TEST_DB_NAME}' AND pid <> pg_backend_pid()`,
    );
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${TEST_DB_NAME}"`);
    await admin.$executeRawUnsafe(`CREATE DATABASE "${TEST_DB_NAME}"`);
  } finally {
    await admin.$disconnect();
  }

  const url = testUrl(base);

  // fileURLToPath, not URL.pathname: on Windows the latter yields
  // "/C:/..." which is not a usable filesystem path.
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

  execSync('npx prisma migrate deploy', {
    cwd: packageRoot,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
    shell: process.platform === 'win32' ? 'cmd.exe' : undefined,
  });

  return url;
}

export function createTestClient(url: string): PrismaClient {
  return new PrismaClient({ datasources: { db: { url } } });
}

/**
 * Delete all data while keeping the schema.
 *
 * TRUNCATE ... CASCADE in one statement rather than per-table deletes, so
 * foreign keys never dictate the order and a new table cannot silently be
 * left un-cleaned between tests.
 */
export async function truncateAll(prisma: PrismaClient): Promise<void> {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;

  if (tables.length === 0) return;

  const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  // Triggers are disabled so the append-only guards on audit_logs and the
  // history tables do not block test cleanup.
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

// ── Fixtures ──────────────────────────────────────────────────────────────

export type SeededBusiness = { id: string; slug: string };

export async function seedBusiness(
  prisma: PrismaClient,
  overrides: { name?: string; slug?: string } = {},
): Promise<SeededBusiness> {
  const slug =
    overrides.slug ?? `test-business-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const business = await prisma.business.create({
    data: {
      id: uuidv7(),
      name: overrides.name ?? 'Test Business',
      slug,
      timezone: 'Asia/Kolkata',
      currency: 'INR',
    },
    select: { id: true, slug: true },
  });

  return business;
}

export async function seedCity(
  prisma: PrismaClient,
  businessId: string,
  overrides: {
    name?: string;
    slug?: string;
    state?: string;
    status?: 'ACTIVE' | 'INACTIVE' | 'COMING_SOON';
    displayOrder?: number;
  } = {},
): Promise<{ id: string; slug: string }> {
  const status = overrides.status ?? 'INACTIVE';

  return prisma.city.create({
    data: {
      id: uuidv7(),
      businessId,
      name: overrides.name ?? 'Test City',
      slug: overrides.slug ?? `test-city-${Math.random().toString(36).slice(2, 8)}`,
      state: overrides.state ?? 'Test State',
      status,
      displayOrder: overrides.displayOrder ?? 0,
      // The CHECK constraint requires activated_at on an ACTIVE row.
      activatedAt: status === 'ACTIVE' ? new Date() : null,
    },
    select: { id: true, slug: true },
  });
}

export async function seedPincode(
  prisma: PrismaClient,
  businessId: string,
  cityId: string,
  overrides: {
    pincode?: string;
    areaName?: string;
    status?: 'ACTIVE' | 'INACTIVE' | 'COMING_SOON';
  } = {},
): Promise<{ id: string; pincode: string }> {
  const status = overrides.status ?? 'INACTIVE';
  // Deterministic-but-unique 6 digits that never start with 0.
  const pincode = overrides.pincode ?? String(100000 + Math.floor(Math.random() * 899999));

  return prisma.servicePincode.create({
    data: {
      id: uuidv7(),
      businessId,
      cityId,
      pincode,
      areaName: overrides.areaName ?? null,
      status,
      activatedAt: status === 'ACTIVE' ? new Date() : null,
    },
    select: { id: true, pincode: true },
  });
}

/** Seeds the full static permission catalogue — mirrors the PHASE 03 migration for tests that build their own database rather than migrating one. */
export async function seedPermissions(
  prisma: PrismaClient,
  permissions: readonly { key: string; resource: string; action: string; description: string }[],
): Promise<void> {
  await prisma.permission.createMany({
    data: permissions.map((p) => ({
      id: uuidv7(),
      key: p.key,
      resource: p.resource,
      action: p.action,
      description: p.description,
    })),
    skipDuplicates: true,
  });
}

/** Seeds one system role scoped to a business, wiring the given permission keys. Permissions must already exist (seedPermissions). */
export async function seedRole(
  prisma: PrismaClient,
  businessId: string,
  overrides: { key: string; name?: string; permissionKeys?: string[]; isSystem?: boolean },
): Promise<{ id: string; key: string }> {
  const permissions = overrides.permissionKeys?.length
    ? await prisma.permission.findMany({
        where: { key: { in: overrides.permissionKeys } },
        select: { id: true },
      })
    : [];

  return prisma.role.create({
    data: {
      id: uuidv7(),
      businessId,
      key: overrides.key,
      name: overrides.name ?? overrides.key,
      isSystem: overrides.isSystem ?? true,
      permissions: { create: permissions.map((p) => ({ permissionId: p.id })) },
    },
    select: { id: true, key: true },
  });
}

/**
 * The password every test-seeded account gets unless a test passes its own
 * — fixed and documented, not a security concern: it only ever exists in
 * the ephemeral test database created/dropped by `setupTestDatabase`
 * (ADR-028), never in any database a real credential could leak from.
 */
export const TEST_PASSWORD = 'Test-password-1234';

/** Seeds a full admin identity with a real password hash: users + admin_users (+ optional role grants). */
export async function seedAdminUser(
  prisma: PrismaClient,
  businessId: string,
  overrides: {
    email?: string;
    /** STAGE C: when set without `email`, seeds an email-free account
     *  identified only by this login ID (matches a founder creating a
     *  staff account with no email address). */
    loginId?: string;
    password?: string;
    fullName?: string;
    isSuperAdmin?: boolean;
    roleIds?: string[];
    status?: 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';
    /** Simulates a pre-PHASE-03 row that has never completed password setup. */
    noPassword?: boolean;
    /**
     * Defaults to false: this helper represents a fully onboarded admin.
     * Sets the EXPLICIT, persisted `must_change_password` column directly
     * (Phase 04 follow-up — this is no longer inferred from
     * `last_password_change_at`). Set true to simulate an admin handed a
     * credential someone else chose/knows (e.g. straight out of the
     * bootstrap flow), which the admin-auth middleware blocks from every
     * route except auth/me, change-password and logout.
     */
    mustChangePassword?: boolean;
    /**
     * Overrides the informational `last_password_change_at` timestamp
     * directly. Defaults to "now" for an admin with a password (`null` for
     * `noPassword`). Exists so a test can simulate a real-world row whose
     * password was set long ago and never changed since — `null` here must
     * NOT by itself trigger the `mustChangePassword` gate; use that override
     * for that.
     */
    lastPasswordChangeAt?: Date | null;
  } = {},
): Promise<{ id: string; userId: string; email: string | null; loginId: string | null; password: string }> {
  const userId = uuidv7();
  const adminUserId = uuidv7();
  // Only auto-generate an email when the caller didn't explicitly ask for
  // a loginId-only (email-free) account.
  const email = overrides.email ?? (overrides.loginId ? null : `test-admin-${uuidv7()}@example.test`);
  const loginId = overrides.loginId ?? null;
  const password = overrides.password ?? TEST_PASSWORD;

  await prisma.user.create({
    data: {
      id: userId,
      userType: 'ADMIN',
      email,
      loginId,
      passwordHash: overrides.noPassword ? null : await hashPassword(password),
      status: overrides.status ?? 'ACTIVE',
    },
  });

  await prisma.adminUser.create({
    data: {
      id: adminUserId,
      businessId,
      userId,
      fullName: overrides.fullName ?? 'Test Admin',
      isSuperAdmin: overrides.isSuperAdmin ?? false,
      mustChangePassword: overrides.mustChangePassword ?? false,
      lastPasswordChangeAt:
        overrides.lastPasswordChangeAt !== undefined
          ? overrides.lastPasswordChangeAt
          : overrides.noPassword
            ? null
            : new Date(),
    },
  });

  if (overrides.roleIds?.length) {
    await prisma.adminUserRole.createMany({
      data: overrides.roleIds.map((roleId) => ({ adminUserId, roleId })),
    });
  }

  return { id: adminUserId, userId, email, loginId, password };
}

/** Seeds a full customer identity with a real password hash: users + customer_profiles. */
export async function seedCustomerUser(
  prisma: PrismaClient,
  businessId: string,
  overrides: {
    email?: string;
    password?: string;
    firstName?: string;
    lastName?: string;
    status?: 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';
  } = {},
): Promise<{ userId: string; profileId: string; email: string; password: string }> {
  const userId = uuidv7();
  const profileId = uuidv7();
  const email = overrides.email ?? `test-customer-${uuidv7()}@example.test`;
  const password = overrides.password ?? TEST_PASSWORD;

  await prisma.user.create({
    data: {
      id: userId,
      userType: 'CUSTOMER',
      email,
      passwordHash: await hashPassword(password),
      status: overrides.status ?? 'ACTIVE',
    },
  });

  await prisma.customerProfile.create({
    data: {
      id: profileId,
      businessId,
      userId,
      firstName: overrides.firstName ?? null,
      lastName: overrides.lastName ?? null,
    },
  });

  return { userId, profileId, email, password };
}

export { uuidv7 as testId };
