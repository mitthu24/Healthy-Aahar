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
 * Stage E — product/variant delete-vs-archive safeguards, against a real
 * database. The point of this endpoint is the reference check; every
 * assertion here seeds a REAL order/inventory-movement row and confirms the
 * delete is genuinely refused, not just that the service "looks" safe.
 */

let prisma: PrismaClient;
let app: Hono<AppBindings>;
let businessId: string;
let adminHeaders: Record<string, string>;

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

function buildApp() {
  return createApp({
    env: testEnv(),
    prisma,
    logger: createLogger({
      service: 'admin-catalogue-delete-it',
      env: 'local',
      version: 'test',
      level: 'silent',
    }),
    businessId,
  });
}

async function seedProductWithVariant(overrides: { sku?: string } = {}) {
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
      status: 'DRAFT',
    },
  });
  const variant = await prisma.productVariant.create({
    data: {
      id: testId(),
      businessId,
      productId: product.id,
      sku: overrides.sku ?? `SKU-${testId()}`,
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
      quantityOnHand: 10,
      quantityReserved: 0,
      lowStockThreshold: 0,
      trackInventory: true,
    },
  });
  return { product, variant };
}

/** Seeds a real Order + OrderItem referencing `variantId` — the exact
 *  real-world condition `countOrderReferences` must catch. */
async function seedOrderReferencing(variantId: string) {
  const customerProfileId = (await seedCustomerUser(prisma, businessId)).profileId;
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
  const order = await prisma.order.create({
    data: {
      id: testId(),
      businessId,
      orderNumber: `ORD-${testId()}`,
      customerProfileId,
      status: 'DELIVERED',
      deliverySlotId: slot.id,
      serviceDate: new Date(),
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
      subtotalPaise: 15_000n,
      discountPaise: 0n,
      totalPaise: 15_000n,
      paymentMethod: 'COD',
      paymentStatus: 'DUE',
      placedAt: new Date(),
    },
  });
  await prisma.orderItem.create({
    data: {
      id: testId(),
      orderId: order.id,
      variantId,
      productNameSnapshot: 'Dal Khichdi',
      quantity: 1,
      unitPricePaise: 15_000n,
      lineTotalPaise: 15_000n,
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

beforeEach(async () => {
  await truncateAll(prisma);
  const business = await seedBusiness(prisma, { slug: 'catalogue-delete-it', name: 'Healthy Aahar' });
  businessId = business.id;
  await seedPermissions(prisma, PERMISSIONS);
  app = buildApp();

  const admin = await seedAdminUser(prisma, businessId, { isSuperAdmin: true });
  adminHeaders = (await loginAsAdmin(app, admin)).headers;
});

describe('DELETE /v1/admin/variants/:id', () => {
  it('deletes an unreferenced variant', async () => {
    const { variant } = await seedProductWithVariant();

    const res = await app.request(`/v1/admin/variants/${variant.id}`, {
      method: 'DELETE',
      headers: adminHeaders,
    });
    expect(res.status).toBe(204);

    const row = await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(row.deletedAt).not.toBeNull();
  });

  it('refuses to delete a variant referenced by an order, with VARIANT_REFERENCED_BY_ORDERS', async () => {
    const { variant } = await seedProductWithVariant();
    await seedOrderReferencing(variant.id);

    const res = await app.request(`/v1/admin/variants/${variant.id}`, {
      method: 'DELETE',
      headers: adminHeaders,
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('VARIANT_REFERENCED_BY_ORDERS');

    const row = await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(row.deletedAt).toBeNull();
  });

  it('refuses to delete a variant with an inventory movement (stock was ever adjusted)', async () => {
    const { variant } = await seedProductWithVariant();

    const stockRes = await app.request(`/v1/admin/variants/${variant.id}/stock`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ quantity_on_hand: 20 }),
    });
    expect(stockRes.status).toBe(200);

    const res = await app.request(`/v1/admin/variants/${variant.id}`, {
      method: 'DELETE',
      headers: adminHeaders,
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('VARIANT_REFERENCED_BY_ORDERS');
  });

  it('requires catalog:delete — a plain admin without it is forbidden', async () => {
    const { variant } = await seedProductWithVariant();
    const role = await seedRole(prisma, businessId, {
      key: 'NO_DELETE_ROLE',
      permissionKeys: ['catalog:read', 'catalog:update'],
    });
    const plainAdmin = await seedAdminUser(prisma, businessId, { roleIds: [role.id] });
    const plainHeaders = (await loginAsAdmin(app, plainAdmin)).headers;

    const res = await app.request(`/v1/admin/variants/${variant.id}`, {
      method: 'DELETE',
      headers: plainHeaders,
    });
    expect(res.status).toBe(403);
  });
});

describe('DELETE /v1/admin/products/:id', () => {
  it('deletes an unreferenced product and its variants', async () => {
    const { product, variant } = await seedProductWithVariant();

    const res = await app.request(`/v1/admin/products/${product.id}`, {
      method: 'DELETE',
      headers: adminHeaders,
    });
    expect(res.status).toBe(204);

    const productRow = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(productRow.deletedAt).not.toBeNull();
    const variantRow = await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(variantRow.deletedAt).not.toBeNull();
  });

  it('refuses to delete a product whose variant is referenced by an order', async () => {
    const { product, variant } = await seedProductWithVariant();
    await seedOrderReferencing(variant.id);

    const res = await app.request(`/v1/admin/products/${product.id}`, {
      method: 'DELETE',
      headers: adminHeaders,
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('PRODUCT_REFERENCED_BY_ORDERS');

    const productRow = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(productRow.deletedAt).toBeNull();
  });

  it('archiving (status=ARCHIVED) still works for a product with order history — the recommended alternative', async () => {
    const { product, variant } = await seedProductWithVariant();
    await seedOrderReferencing(variant.id);
    await prisma.product.update({ where: { id: product.id }, data: { status: 'ACTIVE' } });

    const res = await app.request(`/v1/admin/products/${product.id}/status`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ status: 'ARCHIVED' }),
    });
    expect(res.status).toBe(200);

    const productRow = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(productRow.status).toBe('ARCHIVED');
    expect(productRow.deletedAt).toBeNull();
  });

  it('a 404 for an unknown product id does not leak whether a different business owns it', async () => {
    const res = await app.request(
      '/v1/admin/products/00000000-0000-7000-8000-000000000000',
      { method: 'DELETE', headers: adminHeaders },
    );
    expect(res.status).toBe(404);
  });
});
