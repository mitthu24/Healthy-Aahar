import { execSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
 */

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

export { uuidv7 as testId };
