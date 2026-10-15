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
 * Stage D — founder analytics dashboard, against a real database. Every
 * assertion here compares a dashboard figure to the EXACT source rows this
 * test seeded itself — never a mocked aggregation — so a wrong SQL query
 * (double-counting, a sign error, a missed filter) fails loudly instead of
 * passing against a fake.
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
      service: 'dashboard-it',
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
const LAST_WEEK = '2026-06-08';

/** A Postgres `@db.Date` column stores whatever calendar date the given
 *  instant's UTC digits spell out — so a plain UTC midnight for the
 *  intended business date, not an IST midnight (which would spill onto
 *  the previous UTC day), is what actually lands in `service_date`. */
function asSqlDate(businessDate: string): Date {
  return new Date(`${businessDate}T00:00:00Z`);
}

async function seedVariant(
  overrides: { quantityOnHand?: number; lowStockThreshold?: number } = {},
) {
  const category = await prisma.category.create({
    data: { id: testId(), businessId, name: 'Meals', slug: `meals-${testId()}`, displayOrder: 0 },
  });
  const product = await prisma.product.create({
    data: {
      id: testId(),
      businessId,
      categoryId: category.id,
      name: 'Dal Khichdi',
      slug: `dal-khichdi-${testId()}`,
      status: 'ACTIVE',
    },
  });
  const variant = await prisma.productVariant.create({
    data: {
      id: testId(),
      businessId,
      productId: product.id,
      sku: `SKU-${testId()}`,
      name: '500g',
      unit: 'g',
      unitValue: 500,
      pricePaise: 15_000n,
      availability: 'AVAILABLE',
      isDefault: true,
    },
  });
  await prisma.inventory.create({
    data: {
      id: testId(),
      businessId,
      variantId: variant.id,
      locationCode: 'MAIN',
      quantityOnHand: overrides.quantityOnHand ?? 10,
      quantityReserved: 0,
      lowStockThreshold: overrides.lowStockThreshold ?? 0,
      trackInventory: true,
    },
  });
  return { product, variant };
}

/** Seeds a full Order + Payment (and optionally items), with precise control
 *  over every field the dashboard reads. Bypasses checkout deliberately —
 *  this file tests aggregation, not checkout. */
async function seedOrder(overrides: {
  scopedBusinessId?: string;
  status?: 'PENDING' | 'CONFIRMED' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'CANCELLED' | 'FAILED';
  placedAt: Date;
  deliveredAt?: Date;
  serviceDate?: Date;
  slotEndTime?: Date;
  totalPaise: bigint;
  discountPaise?: bigint;
  paymentMethod?: 'COD' | 'ONLINE';
  paymentStatus?: 'DUE' | 'PAID' | 'PARTIALLY_REFUNDED' | 'REFUNDED';
  amountPaidPaise?: bigint;
  amountRefundedPaise?: bigint;
  customerProfileId?: string;
  items?: Array<{
    variantId: string;
    productName: string;
    quantity: number;
    lineTotalPaise: bigint;
    isComponent?: boolean;
  }>;
}) {
  const scopedBusinessId = overrides.scopedBusinessId ?? businessId;
  const customerProfileId =
    overrides.customerProfileId ?? (await seedCustomerUser(prisma, scopedBusinessId)).profileId;

  const slot = await prisma.deliverySlot.create({
    data: {
      id: testId(),
      businessId: scopedBusinessId,
      name: 'Morning',
      code: `slot-${testId()}`,
      startTime: new Date('1970-01-01T09:00:00.000Z'),
      endTime: overrides.slotEndTime ?? new Date('1970-01-01T12:00:00.000Z'),
      cutoffTime: new Date('1970-01-01T20:00:00.000Z'),
      availableDays: [1, 2, 3, 4, 5, 6, 7],
      defaultCapacity: 50,
      isActive: true,
    },
  });

  const order = await prisma.order.create({
    data: {
      id: testId(),
      businessId: scopedBusinessId,
      orderNumber: `ORD-${testId()}`,
      customerProfileId,
      status: overrides.status ?? 'DELIVERED',
      deliverySlotId: slot.id,
      serviceDate: overrides.serviceDate ?? overrides.placedAt,
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
      // Invariant enforced by the `orders_total_is_sum_of_parts` CHECK
      // constraint: total = subtotal - discount + deliveryFee + tax.
      // Deliberately zero delivery fee/tax here so `totalPaise` is exactly
      // the value each test asserts against.
      subtotalPaise: overrides.totalPaise + (overrides.discountPaise ?? 0n),
      discountPaise: overrides.discountPaise ?? 0n,
      totalPaise: overrides.totalPaise,
      paymentMethod: overrides.paymentMethod ?? 'COD',
      paymentStatus: overrides.paymentStatus ?? 'DUE',
      placedAt: overrides.placedAt,
      deliveredAt: overrides.deliveredAt,
      cancelledAt: overrides.status === 'CANCELLED' ? overrides.placedAt : undefined,
      cancelledByType: overrides.status === 'CANCELLED' ? 'ADMIN' : undefined,
    },
  });

  await prisma.payment.create({
    data: {
      id: testId(),
      orderId: order.id,
      method: overrides.paymentMethod ?? 'COD',
      status: overrides.paymentStatus ?? 'DUE',
      amountPaise: overrides.totalPaise,
      amountPaidPaise: overrides.amountPaidPaise ?? 0n,
      amountRefundedPaise: overrides.amountRefundedPaise ?? 0n,
    },
  });

  if (overrides.items) {
    // A component row (`is_component = true`) must reference its priced
    // parent row via `parent_item_id` — enforced by the
    // `order_items_component_has_parent` CHECK constraint — so parents are
    // created first and every component in this call attaches to the LAST
    // parent created.
    let lastParentId: string | null = null;
    for (const item of overrides.items) {
      const isComponent = item.isComponent ?? false;
      const itemId = testId();
      await prisma.orderItem.create({
        data: {
          id: itemId,
          orderId: order.id,
          variantId: item.variantId,
          parentItemId: isComponent ? lastParentId : null,
          productNameSnapshot: item.productName,
          quantity: item.quantity,
          unitPricePaise: item.lineTotalPaise / BigInt(item.quantity),
          lineTotalPaise: item.lineTotalPaise,
          isComponent,
        },
      });
      if (!isComponent) lastParentId = itemId;
    }
  }

  return order;
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
  const business = await seedBusiness(prisma, { slug: 'dashboard-it', name: 'Healthy Aahar' });
  businessId = business.id;
  await seedPermissions(prisma, PERMISSIONS);
  app = buildApp();

  const founder = await seedAdminUser(prisma, businessId, {
    isSuperAdmin: true,
    fullName: 'Founder Admin',
  });
  founderHeaders = (await loginAsAdmin(app, founder)).headers;
});

describe('GET /v1/admin/dashboard/summary', () => {
  it('returns real zeros and nulls for an empty range — never a fabricated number', async () => {
    const res = await app.request(`/v1/admin/dashboard/summary?from=${TODAY}&to=${TODAY}`, {
      headers: founderHeaders,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      order_count: number;
      gross_sales: { amount_paise: number };
      average_order_value: unknown;
      delivery: { avg_fulfilment_minutes: unknown; on_time_rate: unknown };
      new_customers_count: number;
    };
    expect(body.order_count).toBe(0);
    expect(body.gross_sales.amount_paise).toBe(0);
    expect(body.average_order_value).toBeNull();
    expect(body.delivery.avg_fulfilment_minutes).toBeNull();
    expect(body.delivery.on_time_rate).toBeNull();
    expect(body.new_customers_count).toBe(0);
  });

  it('matches hand-computed totals against exactly the orders/payments this test seeded', async () => {
    // In range, DELIVERED, COD, fully collected, on time (delivered same day as serviceDate).
    await seedOrder({
      status: 'DELIVERED',
      placedAt: new Date(`${TODAY}T05:00:00Z`),
      deliveredAt: new Date(`${TODAY}T10:00:00Z`),
      serviceDate: asSqlDate(TODAY),
      totalPaise: 50_000n,
      discountPaise: 5_000n,
      paymentStatus: 'PAID',
      amountPaidPaise: 50_000n,
    });
    // In range, DELIVERED, COD, NOT yet collected — must count toward net
    // sales but NOT toward "collected", and must count toward outstanding COD.
    await seedOrder({
      status: 'DELIVERED',
      placedAt: new Date(`${TODAY}T06:00:00Z`),
      deliveredAt: new Date(`${TODAY}T11:00:00Z`),
      serviceDate: asSqlDate(TODAY),
      totalPaise: 30_000n,
      paymentStatus: 'DUE',
      amountPaidPaise: 0n,
    });
    // In range, CANCELLED — must count toward gross and cancelled_value, but
    // be EXCLUDED from net_sales and average_order_value's denominator.
    await seedOrder({
      status: 'CANCELLED',
      placedAt: new Date(`${TODAY}T07:00:00Z`),
      totalPaise: 20_000n,
    });
    // In range, DELIVERED, ONLINE, partially refunded.
    await seedOrder({
      status: 'DELIVERED',
      placedAt: new Date(`${TODAY}T08:00:00Z`),
      deliveredAt: new Date(`${TODAY}T09:00:00Z`),
      serviceDate: asSqlDate(TODAY),
      totalPaise: 10_000n,
      paymentMethod: 'ONLINE',
      paymentStatus: 'PARTIALLY_REFUNDED',
      amountPaidPaise: 10_000n,
      amountRefundedPaise: 4_000n,
    });
    // OUTSIDE the range entirely — must not affect any total below.
    await seedOrder({
      status: 'DELIVERED',
      placedAt: new Date(`${LAST_WEEK}T05:00:00Z`),
      deliveredAt: new Date(`${LAST_WEEK}T10:00:00Z`),
      totalPaise: 999_999n,
      paymentStatus: 'PAID',
      amountPaidPaise: 999_999n,
    });

    const res = await app.request(`/v1/admin/dashboard/summary?from=${TODAY}&to=${TODAY}`, {
      headers: founderHeaders,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      order_count: number;
      gross_sales: { amount_paise: number };
      discounts: { amount_paise: number };
      cancelled_count: number;
      cancelled_value: { amount_paise: number };
      net_sales: { amount_paise: number };
      average_order_value: { amount_paise: number };
      collected: { amount_paise: number };
      refunded: { amount_paise: number };
      outstanding_cod: { amount_paise: number };
      status_breakdown: Array<{ status: string; count: number }>;
      delivery: {
        delivered_count: number;
        failed_count: number;
        avg_fulfilment_minutes: number;
        on_time_rate: number;
      };
    };

    expect(body.order_count).toBe(4); // 4 in range, the 5th is excluded by date
    expect(body.gross_sales.amount_paise).toBe(50_000 + 30_000 + 20_000 + 10_000);
    expect(body.discounts.amount_paise).toBe(5_000);
    expect(body.cancelled_count).toBe(1);
    expect(body.cancelled_value.amount_paise).toBe(20_000);
    // net = gross - cancelled = 110000 - 20000
    expect(body.net_sales.amount_paise).toBe(90_000);
    // average = net / (order_count - cancelled_count) = 90000 / 3
    expect(body.average_order_value.amount_paise).toBe(30_000);
    expect(body.collected.amount_paise).toBe(50_000 + 10_000); // NOT the uncollected 30000
    expect(body.refunded.amount_paise).toBe(4_000);
    expect(body.outstanding_cod.amount_paise).toBe(30_000); // only the uncollected COD order

    const delivered = body.status_breakdown.find((s) => s.status === 'DELIVERED');
    const cancelled = body.status_breakdown.find((s) => s.status === 'CANCELLED');
    expect(delivered?.count).toBe(3);
    expect(cancelled?.count).toBe(1);

    expect(body.delivery.delivered_count).toBe(3);
    expect(body.delivery.failed_count).toBe(0);
    // (5h + 5h + 1h) / 3 delivered = 11h/3 = 220 minutes
    expect(body.delivery.avg_fulfilment_minutes).toBeCloseTo(220, 0);
    // All 3 delivered orders were delivered same-day as their service date.
    expect(body.delivery.on_time_rate).toBe(1);
  });

  it('a late delivery (after its service date) is excluded from the on-time count', async () => {
    await seedOrder({
      status: 'DELIVERED',
      placedAt: new Date(`${TODAY}T05:00:00Z`),
      // Delivered the NEXT day (IST) relative to its own service date.
      deliveredAt: new Date(`${TODAY}T20:00:00Z`), // 01:30 IST next day
      serviceDate: asSqlDate(TODAY),
      totalPaise: 10_000n,
    });

    const res = await app.request(`/v1/admin/dashboard/summary?from=${TODAY}&to=${TODAY}`, {
      headers: founderHeaders,
    });
    const body = (await res.json()) as { delivery: { on_time_rate: number } };
    expect(body.delivery.on_time_rate).toBe(0);
  });

  it('counts a customer as new only when first_order_at falls in range', async () => {
    const { profileId } = await seedCustomerUser(prisma, businessId);
    await prisma.customerProfile.update({
      where: { id: profileId },
      data: { firstOrderAt: new Date(`${TODAY}T05:00:00Z`) },
    });
    await seedOrder({
      placedAt: new Date(`${TODAY}T05:00:00Z`),
      totalPaise: 10_000n,
      customerProfileId: profileId,
    });

    const inRange = await app.request(`/v1/admin/dashboard/summary?from=${TODAY}&to=${TODAY}`, {
      headers: founderHeaders,
    });
    expect(((await inRange.json()) as { new_customers_count: number }).new_customers_count).toBe(1);

    const outOfRange = await app.request(
      `/v1/admin/dashboard/summary?from=${YESTERDAY}&to=${YESTERDAY}`,
      { headers: founderHeaders },
    );
    expect(((await outOfRange.json()) as { new_customers_count: number }).new_customers_count).toBe(
      0,
    );
  });

  it('rejects from after to, an invalid date, and a span wider than the bound, with 422', async () => {
    const outOfOrder = await app.request(
      `/v1/admin/dashboard/summary?from=${TODAY}&to=${YESTERDAY}`,
      { headers: founderHeaders },
    );
    expect(outOfOrder.status).toBe(422);

    const invalid = await app.request(`/v1/admin/dashboard/summary?from=not-a-date&to=${TODAY}`, {
      headers: founderHeaders,
    });
    expect(invalid.status).toBe(422);

    const tooWide = await app.request(`/v1/admin/dashboard/summary?from=2020-01-01&to=2026-12-31`, {
      headers: founderHeaders,
    });
    expect(tooWide.status).toBe(422);
  });

  it('requires dashboard:read — a plain admin without it is forbidden', async () => {
    const plainRole = await seedRole(prisma, businessId, {
      key: 'NO_DASHBOARD_ROLE',
      permissionKeys: ['orders:read'],
    });
    const plainAdmin = await seedAdminUser(prisma, businessId, { roleIds: [plainRole.id] });
    const plainHeaders = (await loginAsAdmin(app, plainAdmin)).headers;

    const res = await app.request(`/v1/admin/dashboard/summary?from=${TODAY}&to=${TODAY}`, {
      headers: plainHeaders,
    });
    expect(res.status).toBe(403);
  });

  it("never leaks another business's orders into the totals (tenant isolation)", async () => {
    const otherBusiness = await seedBusiness(prisma, { slug: 'dashboard-it-other' });
    await seedOrder({
      scopedBusinessId: otherBusiness.id,
      placedAt: new Date(`${TODAY}T05:00:00Z`),
      totalPaise: 500_000n,
      paymentStatus: 'PAID',
      amountPaidPaise: 500_000n,
    });
    await seedOrder({
      placedAt: new Date(`${TODAY}T05:00:00Z`),
      totalPaise: 1_000n,
      paymentStatus: 'PAID',
      amountPaidPaise: 1_000n,
    });

    const res = await app.request(`/v1/admin/dashboard/summary?from=${TODAY}&to=${TODAY}`, {
      headers: founderHeaders,
    });
    const body = (await res.json()) as {
      order_count: number;
      gross_sales: { amount_paise: number };
    };
    expect(body.order_count).toBe(1);
    expect(body.gross_sales.amount_paise).toBe(1_000);
  });
});

describe('GET /v1/admin/dashboard/sales-trend', () => {
  it('buckets by IST business day and sums correctly within a bucket', async () => {
    await seedOrder({ placedAt: new Date(`${TODAY}T03:00:00Z`), totalPaise: 10_000n }); // 08:30 IST
    await seedOrder({ placedAt: new Date(`${TODAY}T15:00:00Z`), totalPaise: 20_000n }); // 20:30 IST, same day
    await seedOrder({ placedAt: new Date(`${YESTERDAY}T03:00:00Z`), totalPaise: 5_000n });

    const res = await app.request(`/v1/admin/dashboard/sales-trend?from=${YESTERDAY}&to=${TODAY}`, {
      headers: founderHeaders,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ date: string; order_count: number; gross_sales: { amount_paise: number } }>;
    };
    expect(body.data).toHaveLength(2);
    const today = body.data.find((p) => p.date === TODAY);
    const yesterday = body.data.find((p) => p.date === YESTERDAY);
    expect(today?.order_count).toBe(2);
    expect(today?.gross_sales.amount_paise).toBe(30_000);
    expect(yesterday?.order_count).toBe(1);
    expect(yesterday?.gross_sales.amount_paise).toBe(5_000);
  });
});

describe('GET /v1/admin/dashboard/top-products', () => {
  it('ranks by revenue, excludes cancelled-order items and combo components', async () => {
    const { variant: popular } = await seedVariant();
    const { variant: lessPopular } = await seedVariant();

    await seedOrder({
      placedAt: new Date(`${TODAY}T05:00:00Z`),
      totalPaise: 60_000n,
      items: [
        {
          variantId: popular.id,
          productName: 'Popular Item',
          quantity: 4,
          lineTotalPaise: 60_000n,
        },
        // A combo-component row for the SAME order — must not count twice.
        {
          variantId: popular.id,
          productName: 'Popular Item',
          quantity: 4,
          lineTotalPaise: 0n,
          isComponent: true,
        },
      ],
    });
    await seedOrder({
      placedAt: new Date(`${TODAY}T06:00:00Z`),
      totalPaise: 20_000n,
      items: [
        {
          variantId: lessPopular.id,
          productName: 'Less Popular',
          quantity: 1,
          lineTotalPaise: 20_000n,
        },
      ],
    });
    // A CANCELLED order's items must not count toward top products at all.
    await seedOrder({
      status: 'CANCELLED',
      placedAt: new Date(`${TODAY}T07:00:00Z`),
      totalPaise: 999_000n,
      items: [
        {
          variantId: lessPopular.id,
          productName: 'Less Popular',
          quantity: 99,
          lineTotalPaise: 999_000n,
        },
      ],
    });

    const res = await app.request(`/v1/admin/dashboard/top-products?from=${TODAY}&to=${TODAY}`, {
      headers: founderHeaders,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ variant_id: string; quantity: number; revenue: { amount_paise: number } }>;
    };
    expect(body.data[0]?.variant_id).toBe(popular.id);
    expect(body.data[0]?.quantity).toBe(4);
    expect(body.data[0]?.revenue.amount_paise).toBe(60_000);
    expect(body.data[1]?.variant_id).toBe(lessPopular.id);
    expect(body.data[1]?.quantity).toBe(1); // NOT 100 — the cancelled order's 99 must be excluded
    expect(body.data[1]?.revenue.amount_paise).toBe(20_000);
  });
});

describe('GET /v1/admin/dashboard/inventory-alerts', () => {
  it('lists only variants at or below their own low-stock threshold', async () => {
    const { variant: low } = await seedVariant({ quantityOnHand: 2, lowStockThreshold: 5 });
    const { variant: healthy } = await seedVariant({ quantityOnHand: 50, lowStockThreshold: 5 });

    const res = await app.request('/v1/admin/dashboard/inventory-alerts', {
      headers: founderHeaders,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ variant_id: string; quantity_available: number }>;
    };
    const variantIds = body.data.map((r) => r.variant_id);
    expect(variantIds).toContain(low.id);
    expect(variantIds).not.toContain(healthy.id);
    expect(body.data.find((r) => r.variant_id === low.id)?.quantity_available).toBe(2);
  });

  it("never leaks another business's inventory (tenant isolation)", async () => {
    const otherBusiness = await seedBusiness(prisma, { slug: 'dashboard-it-inv-other' });
    const otherCategory = await prisma.category.create({
      data: {
        id: testId(),
        businessId: otherBusiness.id,
        name: 'Other',
        slug: `other-${testId()}`,
        displayOrder: 0,
      },
    });
    const otherProduct = await prisma.product.create({
      data: {
        id: testId(),
        businessId: otherBusiness.id,
        categoryId: otherCategory.id,
        name: 'Other Product',
        slug: `other-product-${testId()}`,
        status: 'ACTIVE',
      },
    });
    const otherVariant = await prisma.productVariant.create({
      data: {
        id: testId(),
        businessId: otherBusiness.id,
        productId: otherProduct.id,
        sku: `SKU-OTHER-${testId()}`,
        name: 'Other Variant',
        unit: 'g',
        unitValue: 500,
        pricePaise: 1_000n,
        availability: 'AVAILABLE',
        isDefault: true,
      },
    });
    await prisma.inventory.create({
      data: {
        id: testId(),
        businessId: otherBusiness.id,
        variantId: otherVariant.id,
        quantityOnHand: 0,
        quantityReserved: 0,
        lowStockThreshold: 100,
        trackInventory: true,
      },
    });

    const res = await app.request('/v1/admin/dashboard/inventory-alerts', {
      headers: founderHeaders,
    });
    const body = (await res.json()) as { data: Array<{ variant_id: string }> };
    expect(body.data.map((r) => r.variant_id)).not.toContain(otherVariant.id);
  });
});
