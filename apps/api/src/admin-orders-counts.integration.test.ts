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
 * Stage E — admin orders dashboard counts (`GET /v1/admin/orders/counts`),
 * against a real database. Every assertion compares the reported counts to
 * the exact rows this test seeded itself — the whole point of this endpoint
 * is a single aggregated query, so a wrong `groupBy`/date filter fails loudly
 * here rather than passing against a mock.
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
    logger: createLogger({
      service: 'admin-orders-counts-it',
      env: 'local',
      version: 'test',
      level: 'silent',
    }),
    businessId: scopedBusinessId,
  });
}

/** A fixed "today" (IST) every test anchors its ranges to — never the real wall clock. */
const TODAY = '2026-06-15';
const YESTERDAY = '2026-06-14';

async function seedOrder(overrides: {
  scopedBusinessId?: string;
  status?:
    | 'PENDING'
    | 'CONFIRMED'
    | 'PREPARING'
    | 'READY_FOR_DISPATCH'
    | 'OUT_FOR_DELIVERY'
    | 'DELIVERED'
    | 'CANCELLED'
    | 'FAILED'
    | 'RETURNED';
  placedAt: Date;
}) {
  const scopedBusinessId = overrides.scopedBusinessId ?? businessId;
  const customerProfileId = (await seedCustomerUser(prisma, scopedBusinessId)).profileId;

  const slot = await prisma.deliverySlot.create({
    data: {
      id: testId(),
      businessId: scopedBusinessId,
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

  const status = overrides.status ?? 'CONFIRMED';
  const isCancelLike = status === 'CANCELLED' || status === 'FAILED' || status === 'RETURNED';

  const order = await prisma.order.create({
    data: {
      id: testId(),
      businessId: scopedBusinessId,
      orderNumber: `ORD-${testId()}`,
      customerProfileId,
      status,
      deliverySlotId: slot.id,
      serviceDate: overrides.placedAt,
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
      subtotalPaise: 1_000n,
      discountPaise: 0n,
      totalPaise: 1_000n,
      paymentMethod: 'COD',
      paymentStatus: 'DUE',
      placedAt: overrides.placedAt,
      cancelledAt: isCancelLike ? overrides.placedAt : undefined,
      cancelledByType: isCancelLike ? 'ADMIN' : undefined,
    },
  });

  await prisma.payment.create({
    data: {
      id: testId(),
      orderId: order.id,
      method: 'COD',
      status: 'DUE',
      amountPaise: 1_000n,
      amountPaidPaise: 0n,
      amountRefundedPaise: 0n,
    },
  });

  return order;
}

beforeAll(async () => {
  const url = await setupTestDatabase();
  prisma = createTestClient(url);
}, 180_000);

afterAll(async () => {
  await prisma?.$disconnect();
});

let founderHeaders: Record<string, string>;

beforeEach(async () => {
  await truncateAll(prisma);
  const business = await seedBusiness(prisma, { slug: 'orders-counts-it', name: 'Healthy Aahar' });
  businessId = business.id;
  await seedPermissions(prisma, PERMISSIONS);
  app = buildApp();

  const founder = await seedAdminUser(prisma, businessId, {
    isSuperAdmin: true,
    fullName: 'Founder Admin',
  });
  founderHeaders = (await loginAsAdmin(app, founder)).headers;
});

describe('GET /v1/admin/orders/counts', () => {
  it('returns real zeros for an empty range', async () => {
    const res = await app.request(`/v1/admin/orders/counts?from=${TODAY}&to=${TODAY}`, {
      headers: founderHeaders,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { total: number; by_status: unknown[] };
    expect(body.total).toBe(0);
    expect(body.by_status).toEqual([]);
  });

  it('counts every status with a single aggregated query, not a fabricated number', async () => {
    await seedOrder({ status: 'CONFIRMED', placedAt: new Date(`${TODAY}T05:00:00Z`) });
    await seedOrder({ status: 'CONFIRMED', placedAt: new Date(`${TODAY}T06:00:00Z`) });
    await seedOrder({ status: 'PREPARING', placedAt: new Date(`${TODAY}T07:00:00Z`) });
    await seedOrder({ status: 'READY_FOR_DISPATCH', placedAt: new Date(`${TODAY}T08:00:00Z`) });
    await seedOrder({ status: 'OUT_FOR_DELIVERY', placedAt: new Date(`${TODAY}T09:00:00Z`) });
    await seedOrder({ status: 'DELIVERED', placedAt: new Date(`${TODAY}T10:00:00Z`) });
    await seedOrder({ status: 'CANCELLED', placedAt: new Date(`${TODAY}T11:00:00Z`) });

    const res = await app.request(`/v1/admin/orders/counts?from=${TODAY}&to=${TODAY}`, {
      headers: founderHeaders,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      total: number;
      by_status: Array<{ status: string; count: number }>;
    };
    expect(body.total).toBe(7);
    const byStatus = Object.fromEntries(body.by_status.map((row) => [row.status, row.count]));
    expect(byStatus).toEqual({
      CONFIRMED: 2,
      PREPARING: 1,
      READY_FOR_DISPATCH: 1,
      OUT_FOR_DELIVERY: 1,
      DELIVERED: 1,
      CANCELLED: 1,
    });
  });

  it('excludes orders outside the selected date range', async () => {
    await seedOrder({ status: 'CONFIRMED', placedAt: new Date(`${TODAY}T05:00:00Z`) });
    await seedOrder({ status: 'CONFIRMED', placedAt: new Date(`${YESTERDAY}T05:00:00Z`) });

    const res = await app.request(`/v1/admin/orders/counts?from=${TODAY}&to=${TODAY}`, {
      headers: founderHeaders,
    });
    const body = (await res.json()) as { total: number };
    expect(body.total).toBe(1);
  });

  it('respects the IST business-day boundary — 11:30pm IST yesterday is not "today"', async () => {
    // 2026-06-14T23:30 IST == 2026-06-14T18:00Z — the previous business day.
    await seedOrder({ status: 'CONFIRMED', placedAt: new Date(`${YESTERDAY}T18:00:00Z`) });
    // 2026-06-15T00:30 IST == 2026-06-14T19:00Z — just past midnight IST, already "today".
    await seedOrder({ status: 'CONFIRMED', placedAt: new Date(`${YESTERDAY}T19:00:00Z`) });

    const res = await app.request(`/v1/admin/orders/counts?from=${TODAY}&to=${TODAY}`, {
      headers: founderHeaders,
    });
    const body = (await res.json()) as { total: number };
    expect(body.total).toBe(1);
  });

  it('rejects an invalid date range (from after to) with 422', async () => {
    const res = await app.request(`/v1/admin/orders/counts?from=${TODAY}&to=${YESTERDAY}`, {
      headers: founderHeaders,
    });
    expect(res.status).toBe(422);
  });

  it('requires orders:read — a plain admin without it is forbidden', async () => {
    const plainRole = await seedRole(prisma, businessId, {
      key: 'NO_ORDERS_ROLE',
      permissionKeys: ['dashboard:read'],
    });
    const plainAdmin = await seedAdminUser(prisma, businessId, { roleIds: [plainRole.id] });
    const plainHeaders = (await loginAsAdmin(app, plainAdmin)).headers;

    const res = await app.request(`/v1/admin/orders/counts?from=${TODAY}&to=${TODAY}`, {
      headers: plainHeaders,
    });
    expect(res.status).toBe(403);
  });

  it("never leaks another business's orders into the counts (tenant isolation)", async () => {
    const otherBusiness = await seedBusiness(prisma, { slug: 'orders-counts-it-other' });
    await seedOrder({
      scopedBusinessId: otherBusiness.id,
      status: 'CONFIRMED',
      placedAt: new Date(`${TODAY}T05:00:00Z`),
    });
    await seedOrder({ status: 'CONFIRMED', placedAt: new Date(`${TODAY}T05:00:00Z`) });

    const res = await app.request(`/v1/admin/orders/counts?from=${TODAY}&to=${TODAY}`, {
      headers: founderHeaders,
    });
    const body = (await res.json()) as { total: number };
    expect(body.total).toBe(1);
  });

  it('the order list and the counts agree on the same date range', async () => {
    await seedOrder({ status: 'CONFIRMED', placedAt: new Date(`${TODAY}T05:00:00Z`) });
    await seedOrder({ status: 'DELIVERED', placedAt: new Date(`${YESTERDAY}T05:00:00Z`) });

    const [countsRes, listRes] = await Promise.all([
      app.request(`/v1/admin/orders/counts?from=${TODAY}&to=${TODAY}`, {
        headers: founderHeaders,
      }),
      app.request(`/v1/admin/orders?from=${TODAY}&to=${TODAY}`, { headers: founderHeaders }),
    ]);
    const counts = (await countsRes.json()) as { total: number };
    const list = (await listRes.json()) as { data: unknown[] };
    expect(counts.total).toBe(1);
    expect(list.data).toHaveLength(1);
  });
});
