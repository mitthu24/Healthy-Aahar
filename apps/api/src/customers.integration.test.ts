import type { ServerEnv } from '@healthy-aahar/config/env/server';
import { now, PERMISSIONS } from '@healthy-aahar/core';
import type { PrismaClient } from '@healthy-aahar/db';
import {
  createTestClient,
  seedAdminUser,
  seedBusiness,
  seedCustomerUser,
  seedPermissions,
  seedRole,
  setupTestDatabase,
  testId,
  truncateAll,
} from '@healthy-aahar/db/testing';
import { createLogger } from '@healthy-aahar/observability';
import type { Hono } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import { loginAsAdmin } from './test-support/admin-session.js';
import type { AppBindings } from './types.js';

/**
 * Stage E — founder customer directory, against a real database. Every
 * assertion compares against exactly the records this test seeded itself,
 * and masking/PII-reveal/tenant-isolation are exercised through the real
 * HTTP routes, not the service directly.
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
    LOGIN_RATE_LIMIT_PER_MIN: 50,
    REGISTER_RATE_LIMIT_PER_MIN: 50,
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
    RATE_LIMIT_READ_PER_MIN: 1000,
    RATE_LIMIT_WRITE_PER_MIN: 1000,
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

function buildApp(scopedBusinessId = businessId) {
  return createApp({
    env: testEnv(),
    prisma,
    logger: createLogger({ service: 'customers-it', env: 'local', version: 'test', level: 'silent' }),
    businessId: scopedBusinessId,
  });
}

async function seedOrder(overrides: {
  customerProfileId: string;
  status?: 'CONFIRMED' | 'DELIVERED' | 'CANCELLED';
  totalPaise: bigint;
  placedAt?: Date;
}) {
  const slot = await prisma.deliverySlot.create({
    data: {
      id: testId(),
      businessId,
      name: 'Morning',
      code: `slot-${testId()}`,
      startTime: new Date('1970-01-01T09:00:00.000Z'),
      endTime: new Date('1970-01-01T12:00:00.000Z'),
      cutoffTime: new Date('1970-01-01T20:00:00.000Z'),
      availableDays: [1, 2, 3, 4, 5, 6, 7],
      defaultCapacity: 50,
      isActive: true,
    },
  });

  return prisma.order.create({
    data: {
      id: testId(),
      businessId,
      orderNumber: `ORD-${testId()}`,
      customerProfileId: overrides.customerProfileId,
      status: overrides.status ?? 'DELIVERED',
      deliverySlotId: slot.id,
      serviceDate: overrides.placedAt ?? now(),
      slotStartTime: slot.startTime,
      slotEndTime: slot.endTime,
      slotNameSnapshot: slot.name,
      addressSnapshot: {
        recipientName: 'Jane Customer',
        recipientPhone: '+919876543210',
        line1: '1 Main St',
        line2: null,
        landmark: null,
        city: 'Noida',
        state: 'UP',
        pincode: '201301',
      },
      customerNameSnapshot: 'Jane Customer',
      customerPhoneSnapshot: '+919876543210',
      subtotalPaise: overrides.totalPaise,
      totalPaise: overrides.totalPaise,
      paymentMethod: 'COD',
      paymentStatus: 'DUE',
      placedAt: overrides.placedAt ?? now(),
      cancelledAt: overrides.status === 'CANCELLED' ? now() : undefined,
      cancelledByType: overrides.status === 'CANCELLED' ? 'ADMIN' : undefined,
    },
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

let founderHeaders: Record<string, string>;

beforeEach(async () => {
  await truncateAll(prisma);
  const business = await seedBusiness(prisma, { slug: 'customers-it', name: 'Healthy Aahar' });
  businessId = business.id;
  await seedPermissions(prisma, PERMISSIONS);
  app = buildApp();

  const founder = await seedAdminUser(prisma, businessId, {
    isSuperAdmin: true,
    fullName: 'Founder Admin',
  });
  founderHeaders = (await loginAsAdmin(app, founder)).headers;
});

describe('GET /v1/admin/customers', () => {
  it('lists customers with masked email/phone and live order aggregates', async () => {
    const customer = await seedCustomerUser(prisma, businessId, {
      email: 'jasmine@example.test',
      firstName: 'Jasmine',
      lastName: 'Rao',
    });
    await prisma.user.update({
      where: { id: customer.userId },
      data: { phone: '+919876543210' },
    });
    await seedOrder({ customerProfileId: customer.profileId, totalPaise: 10_000n });
    await seedOrder({ customerProfileId: customer.profileId, totalPaise: 20_000n });
    // A cancelled order must NOT count toward total_orders/lifetime_value.
    await seedOrder({
      customerProfileId: customer.profileId,
      totalPaise: 999_000n,
      status: 'CANCELLED',
    });

    const res = await app.request('/v1/admin/customers', { headers: founderHeaders });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{
        id: string;
        full_name: string | null;
        email: string | null;
        phone: string | null;
        total_orders: number;
        lifetime_value: { amount_paise: number };
      }>;
    };
    const row = body.data.find((r) => r.id === customer.profileId);
    expect(row).toBeTruthy();
    expect(row?.full_name).toBe('Jasmine Rao');
    expect(row?.email).toBe('j*****e@example.test');
    expect(row?.email).not.toContain('jasmine');
    expect(row?.phone).toBe('+********3210');
    expect(row?.total_orders).toBe(2);
    expect(row?.lifetime_value.amount_paise).toBe(30_000);
  });

  it('searches by name, email and phone', async () => {
    const a = await seedCustomerUser(prisma, businessId, {
      email: 'alice@example.test',
      firstName: 'Alice',
    });
    const b = await seedCustomerUser(prisma, businessId, {
      email: 'bob@example.test',
      firstName: 'Bob',
    });

    const byName = await app.request('/v1/admin/customers?q=Alice', { headers: founderHeaders });
    const byNameBody = (await byName.json()) as { data: Array<{ id: string }> };
    expect(byNameBody.data.map((r) => r.id)).toContain(a.profileId);
    expect(byNameBody.data.map((r) => r.id)).not.toContain(b.profileId);

    const byEmail = await app.request('/v1/admin/customers?q=bob@example', {
      headers: founderHeaders,
    });
    const byEmailBody = (await byEmail.json()) as { data: Array<{ id: string }> };
    expect(byEmailBody.data.map((r) => r.id)).toContain(b.profileId);
    expect(byEmailBody.data.map((r) => r.id)).not.toContain(a.profileId);
  });

  it('filters by account status', async () => {
    const active = await seedCustomerUser(prisma, businessId, { status: 'ACTIVE' });
    const suspended = await seedCustomerUser(prisma, businessId, { status: 'SUSPENDED' });

    const res = await app.request('/v1/admin/customers?status=SUSPENDED', {
      headers: founderHeaders,
    });
    const body = (await res.json()) as { data: Array<{ id: string }> };
    expect(body.data.map((r) => r.id)).toContain(suspended.profileId);
    expect(body.data.map((r) => r.id)).not.toContain(active.profileId);
  });

  it('paginates with a real cursor, no duplicate or skipped rows', async () => {
    for (let i = 0; i < 5; i++) {
      await seedCustomerUser(prisma, businessId);
    }

    const page1 = await app.request('/v1/admin/customers?limit=2', { headers: founderHeaders });
    const page1Body = (await page1.json()) as {
      data: Array<{ id: string }>;
      pagination: { has_more: boolean; next_cursor: string | null };
    };
    expect(page1Body.data).toHaveLength(2);
    expect(page1Body.pagination.has_more).toBe(true);
    expect(page1Body.pagination.next_cursor).toBeTruthy();

    const page2 = await app.request(
      `/v1/admin/customers?limit=2&cursor=${encodeURIComponent(page1Body.pagination.next_cursor!)}`,
      { headers: founderHeaders },
    );
    const page2Body = (await page2.json()) as { data: Array<{ id: string }> };
    const page1Ids = new Set(page1Body.data.map((r) => r.id));
    for (const row of page2Body.data) {
      expect(page1Ids.has(row.id)).toBe(false);
    }
  });

  it('returns an empty, non-fabricated page when there are no customers', async () => {
    const res = await app.request('/v1/admin/customers', { headers: founderHeaders });
    const body = (await res.json()) as { data: unknown[]; pagination: { has_more: boolean } };
    expect(body.data).toEqual([]);
    expect(body.pagination.has_more).toBe(false);
  });

  it('never leaks another business\'s customers (tenant isolation)', async () => {
    const otherBusiness = await seedBusiness(prisma, { slug: 'customers-it-other' });
    const other = await seedCustomerUser(prisma, otherBusiness.id);
    const mine = await seedCustomerUser(prisma, businessId);

    const res = await app.request('/v1/admin/customers', { headers: founderHeaders });
    const body = (await res.json()) as { data: Array<{ id: string }> };
    expect(body.data.map((r) => r.id)).toContain(mine.profileId);
    expect(body.data.map((r) => r.id)).not.toContain(other.profileId);
  });

  it('requires customers:read — forbidden without it', async () => {
    const plainRole = await seedRole(prisma, businessId, {
      key: 'NO_CUSTOMERS_ROLE',
      permissionKeys: ['orders:read'],
    });
    const plainAdmin = await seedAdminUser(prisma, businessId, { roleIds: [plainRole.id] });
    const plainHeaders = (await loginAsAdmin(app, plainAdmin)).headers;

    const res = await app.request('/v1/admin/customers', { headers: plainHeaders });
    expect(res.status).toBe(403);
  });
});

describe('GET /v1/admin/customers/:id', () => {
  it('returns masked detail plus recent order history', async () => {
    const customer = await seedCustomerUser(prisma, businessId, { email: 'carol@example.test' });
    await seedOrder({ customerProfileId: customer.profileId, totalPaise: 15_000n });

    const res = await app.request(`/v1/admin/customers/${customer.profileId}`, {
      headers: founderHeaders,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      email: string | null;
      recent_orders: Array<{ total: { amount_paise: number } }>;
    };
    expect(body.email).not.toContain('carol');
    expect(body.recent_orders).toHaveLength(1);
    expect(body.recent_orders[0]?.total.amount_paise).toBe(15_000);
  });

  it('404s for an unknown customer, not a crash', async () => {
    const res = await app.request('/v1/admin/customers/00000000-0000-0000-0000-000000000000', {
      headers: founderHeaders,
    });
    expect(res.status).toBe(404);
  });

  it('never returns another business\'s customer by id (tenant isolation, 404 not leaked)', async () => {
    const otherBusiness = await seedBusiness(prisma, { slug: 'customers-it-detail-other' });
    const other = await seedCustomerUser(prisma, otherBusiness.id);

    const res = await app.request(`/v1/admin/customers/${other.profileId}`, {
      headers: founderHeaders,
    });
    expect(res.status).toBe(404);
  });
});

describe('POST /v1/admin/customers/:id/reveal-pii', () => {
  it('returns the real email/phone and writes an audit event', async () => {
    const pii = await seedRole(prisma, businessId, {
      key: 'PII_ROLE',
      permissionKeys: ['customers:read', 'customers:read_pii'],
    });
    const piiAdmin = await seedAdminUser(prisma, businessId, { roleIds: [pii.id] });
    const piiHeaders = (await loginAsAdmin(app, piiAdmin)).headers;

    const customer = await seedCustomerUser(prisma, businessId, { email: 'dave@example.test' });
    await prisma.user.update({ where: { id: customer.userId }, data: { phone: '+919876543210' } });

    const res = await app.request(`/v1/admin/customers/${customer.profileId}/reveal-pii`, {
      method: 'POST',
      headers: piiHeaders,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { email: string; phone: string };
    expect(body.email).toBe('dave@example.test');
    expect(body.phone).toBe('+919876543210');

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'customer.pii_unmasked', resourceId: customer.profileId },
    });
    expect(audit).not.toBeNull();
  });

  it('is forbidden for an admin with customers:read but not customers:read_pii', async () => {
    const readOnly = await seedRole(prisma, businessId, {
      key: 'READ_ONLY_ROLE',
      permissionKeys: ['customers:read'],
    });
    const readOnlyAdmin = await seedAdminUser(prisma, businessId, { roleIds: [readOnly.id] });
    const readOnlyHeaders = (await loginAsAdmin(app, readOnlyAdmin)).headers;

    const customer = await seedCustomerUser(prisma, businessId);
    const res = await app.request(`/v1/admin/customers/${customer.profileId}/reveal-pii`, {
      method: 'POST',
      headers: readOnlyHeaders,
    });
    expect(res.status).toBe(403);
  });
});

describe('GET /v1/admin/customers/export.csv', () => {
  it('exports masked rows as CSV with the right content type', async () => {
    const customer = await seedCustomerUser(prisma, businessId, { email: 'erin@example.test' });

    const res = await app.request('/v1/admin/customers/export.csv', { headers: founderHeaders });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    const text = await res.text();
    expect(text).toContain('id,full_name,email_masked');
    expect(text).not.toContain('erin@example.test');
    expect(text).toContain(customer.profileId);
  });

  it('requires customers:read for the export too', async () => {
    const plainRole = await seedRole(prisma, businessId, {
      key: 'NO_EXPORT_ROLE',
      permissionKeys: ['orders:read'],
    });
    const plainAdmin = await seedAdminUser(prisma, businessId, { roleIds: [plainRole.id] });
    const plainHeaders = (await loginAsAdmin(app, plainAdmin)).headers;

    const res = await app.request('/v1/admin/customers/export.csv', { headers: plainHeaders });
    expect(res.status).toBe(403);
  });
});
