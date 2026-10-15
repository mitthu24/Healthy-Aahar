import type { ServerEnv } from '@healthy-aahar/config/env/server';
import { PERMISSIONS } from '@healthy-aahar/core';
import type { PrismaClient } from '@healthy-aahar/db';
import {
  createTestClient,
  seedAdminUser,
  seedBusiness,
  seedPermissions,
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
 * Stage E — SKU uniqueness, unit validation, tax rate, and category
 * parent/child, against a real database.
 */

let prisma: PrismaClient;
let app: Hono<AppBindings>;
let businessId: string;
let adminHeaders: Record<string, string>;
let categoryId: string;
let productId: string;

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
      service: 'admin-catalogue-fields-it',
      env: 'local',
      version: 'test',
      level: 'silent',
    }),
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
  const business = await seedBusiness(prisma, {
    slug: 'catalogue-fields-it',
    name: 'Healthy Aahar',
  });
  businessId = business.id;
  await seedPermissions(prisma, PERMISSIONS);
  app = buildApp();

  const admin = await seedAdminUser(prisma, businessId, { isSuperAdmin: true });
  adminHeaders = (await loginAsAdmin(app, admin)).headers;

  const category = await prisma.category.create({
    data: { id: testId(), businessId, name: 'Meals', slug: `meals-${testId()}`, displayOrder: 0 },
  });
  categoryId = category.id;
  const product = await prisma.product.create({
    data: {
      id: testId(),
      businessId,
      categoryId,
      name: 'Dal Khichdi',
      slug: `dal-khichdi-${testId()}`,
      status: 'DRAFT',
    },
  });
  productId = product.id;
});

describe('SKU uniqueness', () => {
  it('rejects a duplicate SKU within the same business, with SKU_TAKEN', async () => {
    const first = await app.request(`/v1/admin/products/${productId}/variants`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        sku: 'SKU-DUP-1',
        name: '500g',
        unit: 'g',
        unit_value: 500,
        price_paise: 10_000,
      }),
    });
    expect(first.status).toBe(201);

    const second = await app.request(`/v1/admin/products/${productId}/variants`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        sku: 'SKU-DUP-1',
        name: '1kg',
        unit: 'kg',
        unit_value: 1,
        price_paise: 18_000,
      }),
    });
    expect(second.status).toBe(409);
    const body = (await second.json()) as { error: { code: string } };
    expect(body.error.code).toBe('SKU_TAKEN');
  });

  it('allows the same SKU across two different businesses', async () => {
    const otherBusiness = await seedBusiness(prisma, { slug: 'catalogue-fields-it-other' });
    const otherApp = createApp({
      env: testEnv(),
      prisma,
      logger: createLogger({
        service: 'catalogue-fields-it-other',
        env: 'local',
        version: 'test',
        level: 'silent',
      }),
      businessId: otherBusiness.id,
    });
    const otherAdmin = await seedAdminUser(prisma, otherBusiness.id, { isSuperAdmin: true });
    const otherHeaders = (await loginAsAdmin(otherApp, otherAdmin)).headers;
    const otherCategory = await prisma.category.create({
      data: {
        id: testId(),
        businessId: otherBusiness.id,
        name: 'Meals',
        slug: `meals-${testId()}`,
        displayOrder: 0,
      },
    });
    const otherProduct = await prisma.product.create({
      data: {
        id: testId(),
        businessId: otherBusiness.id,
        categoryId: otherCategory.id,
        name: 'Other Product',
        slug: `other-${testId()}`,
        status: 'DRAFT',
      },
    });

    const here = await app.request(`/v1/admin/products/${productId}/variants`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        sku: 'SKU-SHARED',
        name: '500g',
        unit: 'g',
        unit_value: 500,
        price_paise: 10_000,
      }),
    });
    expect(here.status).toBe(201);

    const there = await otherApp.request(`/v1/admin/products/${otherProduct.id}/variants`, {
      method: 'POST',
      headers: otherHeaders,
      body: JSON.stringify({
        sku: 'SKU-SHARED',
        name: '500g',
        unit: 'g',
        unit_value: 500,
        price_paise: 10_000,
      }),
    });
    expect(there.status).toBe(201);
  });

  it('a deleted variant’s SKU can be reused', async () => {
    const created = await app.request(`/v1/admin/products/${productId}/variants`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        sku: 'SKU-REUSABLE',
        name: '500g',
        unit: 'g',
        unit_value: 500,
        price_paise: 10_000,
      }),
    });
    expect(created.status).toBe(201);
    const { id: variantId } = (await created.json()) as { id: string };

    const deleted = await app.request(`/v1/admin/variants/${variantId}`, {
      method: 'DELETE',
      headers: adminHeaders,
    });
    expect(deleted.status).toBe(204);

    const recreated = await app.request(`/v1/admin/products/${productId}/variants`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        sku: 'SKU-REUSABLE',
        name: '1kg',
        unit: 'kg',
        unit_value: 1,
        price_paise: 18_000,
      }),
    });
    expect(recreated.status).toBe(201);
  });
});

describe('unit validation', () => {
  it('rejects an unknown unit code with 422', async () => {
    const res = await app.request(`/v1/admin/products/${productId}/variants`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        sku: 'SKU-BADUNIT',
        name: 'Odd pack',
        unit: 'bananas',
        unit_value: 1,
        price_paise: 10_000,
      }),
    });
    expect(res.status).toBe(422);
  });

  it('accepts every catalogued unit code', async () => {
    for (const unit of ['g', 'kg', 'ml', 'L', 'piece', 'pack']) {
      const res = await app.request(`/v1/admin/products/${productId}/variants`, {
        method: 'POST',
        headers: adminHeaders,
        body: JSON.stringify({
          sku: `SKU-UNIT-${unit}`,
          name: `Variant (${unit})`,
          unit,
          unit_value: 1,
          price_paise: 10_000,
        }),
      });
      expect(res.status).toBe(201);
    }
  });
});

describe('tax rate', () => {
  it('round-trips tax_rate_bps through create, update and read', async () => {
    const created = await app.request(`/v1/admin/products/${productId}/variants`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        sku: 'SKU-TAX',
        name: '500g',
        unit: 'g',
        unit_value: 500,
        price_paise: 10_000,
        tax_rate_bps: 500,
      }),
    });
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as { id: string; tax_rate_bps: number };
    expect(createdBody.tax_rate_bps).toBe(500);

    const updated = await app.request(`/v1/admin/variants/${createdBody.id}`, {
      method: 'PATCH',
      headers: adminHeaders,
      body: JSON.stringify({ tax_rate_bps: 1200 }),
    });
    expect(updated.status).toBe(200);
    const updatedBody = (await updated.json()) as { tax_rate_bps: number };
    expect(updatedBody.tax_rate_bps).toBe(1200);
  });

  it('defaults to zero when omitted', async () => {
    const res = await app.request(`/v1/admin/products/${productId}/variants`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        sku: 'SKU-NOTAX',
        name: '500g',
        unit: 'g',
        unit_value: 500,
        price_paise: 10_000,
      }),
    });
    const body = (await res.json()) as { tax_rate_bps: number };
    expect(body.tax_rate_bps).toBe(0);
  });
});

describe('category parent/child (BR-C1)', () => {
  it('creates a subcategory under a top-level category', async () => {
    const res = await app.request('/v1/admin/categories', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        name: 'Breakfast',
        slug: `breakfast-${testId()}`,
        parent_id: categoryId,
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { parent_id: string | null };
    expect(body.parent_id).toBe(categoryId);
  });

  it('refuses a 3rd level — a subcategory cannot itself be a parent', async () => {
    const sub = await app.request('/v1/admin/categories', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        name: 'Breakfast',
        slug: `breakfast-${testId()}`,
        parent_id: categoryId,
      }),
    });
    const { id: subId } = (await sub.json()) as { id: string };

    const thirdLevel = await app.request('/v1/admin/categories', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        name: 'Cereal',
        slug: `cereal-${testId()}`,
        parent_id: subId,
      }),
    });
    expect(thirdLevel.status).toBe(422);
    const body = (await thirdLevel.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_CATEGORY_PARENT');
  });

  it('refuses a category becoming its own parent', async () => {
    const res = await app.request(`/v1/admin/categories/${categoryId}`, {
      method: 'PATCH',
      headers: adminHeaders,
      body: JSON.stringify({ parent_id: categoryId }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_CATEGORY_PARENT');
  });

  it('refuses giving a parent to a category that already has its own subcategories', async () => {
    const sub = await app.request('/v1/admin/categories', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        name: 'Breakfast',
        slug: `breakfast-${testId()}`,
        parent_id: categoryId,
      }),
    });
    expect(sub.status).toBe(201);

    const otherTop = await app.request('/v1/admin/categories', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ name: 'Other Top', slug: `other-top-${testId()}` }),
    });
    const { id: otherTopId } = (await otherTop.json()) as { id: string };

    // categoryId already has `sub` as a child — making it a child of
    // otherTopId would create a 3rd level transitively.
    const res = await app.request(`/v1/admin/categories/${categoryId}`, {
      method: 'PATCH',
      headers: adminHeaders,
      body: JSON.stringify({ parent_id: otherTopId }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_CATEGORY_PARENT');
  });

  it('clearing parent_id (null) demotes a subcategory back to top-level', async () => {
    const sub = await app.request('/v1/admin/categories', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        name: 'Breakfast',
        slug: `breakfast-${testId()}`,
        parent_id: categoryId,
      }),
    });
    const { id: subId } = (await sub.json()) as { id: string };

    const res = await app.request(`/v1/admin/categories/${subId}`, {
      method: 'PATCH',
      headers: adminHeaders,
      body: JSON.stringify({ parent_id: null }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { parent_id: string | null };
    expect(body.parent_id).toBeNull();
  });
});
