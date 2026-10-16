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
 * Stage F — Global Settings: database-backed units and the configurable
 * catalogue tax-rate ceiling, against a real database. `settings:read`/
 * `settings:update` already existed in the permission catalogue but were
 * unused by any route before this.
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
      service: 'admin-settings-it',
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
  const business = await seedBusiness(prisma, { slug: 'admin-settings-it', name: 'Healthy Aahar' });
  businessId = business.id;
  await seedPermissions(prisma, PERMISSIONS);
  app = buildApp();

  const admin = await seedAdminUser(prisma, businessId, { isSuperAdmin: true });
  adminHeaders = (await loginAsAdmin(app, admin)).headers;
});

describe('GET /v1/admin/settings/units', () => {
  it('starts empty for a business that has not had units seeded', async () => {
    const res = await app.request('/v1/admin/settings/units', { headers: adminHeaders });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toEqual([]);
  });

  it('requires settings:read', async () => {
    const role = await seedRole(prisma, businessId, { key: 'NO_SETTINGS', permissionKeys: ['orders:read'] });
    const plainAdmin = await seedAdminUser(prisma, businessId, { roleIds: [role.id] });
    const plainHeaders = (await loginAsAdmin(app, plainAdmin)).headers;

    const res = await app.request('/v1/admin/settings/units', { headers: plainHeaders });
    expect(res.status).toBe(403);
  });
});

describe('POST /v1/admin/settings/units', () => {
  it('creates a unit', async () => {
    const res = await app.request('/v1/admin/settings/units', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ code: 'oz', label: 'Ounces (oz)', symbol: 'oz', dimension: 'MASS' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { code: string; is_active: boolean };
    expect(body.code).toBe('oz');
    expect(body.is_active).toBe(true);
  });

  it('rejects a duplicate code within the same business with 409 UNIT_CODE_TAKEN', async () => {
    await app.request('/v1/admin/settings/units', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ code: 'oz', label: 'Ounces', symbol: 'oz', dimension: 'MASS' }),
    });
    const second = await app.request('/v1/admin/settings/units', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ code: 'oz', label: 'Ounces again', symbol: 'oz', dimension: 'MASS' }),
    });
    expect(second.status).toBe(409);
    const body = (await second.json()) as { error: { code: string } };
    expect(body.error.code).toBe('UNIT_CODE_TAKEN');

    const count = await prisma.unit.count({ where: { businessId, code: 'oz' } });
    expect(count).toBe(1);
  });

  it('allows the same code across two different businesses', async () => {
    const otherBusiness = await seedBusiness(prisma, { slug: 'admin-settings-it-other' });
    const otherApp = createApp({
      env: testEnv(),
      prisma,
      logger: createLogger({ service: 'other', env: 'local', version: 'test', level: 'silent' }),
      businessId: otherBusiness.id,
    });
    const otherAdmin = await seedAdminUser(prisma, otherBusiness.id, { isSuperAdmin: true });
    const otherHeaders = (await loginAsAdmin(otherApp, otherAdmin)).headers;

    const here = await app.request('/v1/admin/settings/units', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ code: 'oz', label: 'Ounces', symbol: 'oz', dimension: 'MASS' }),
    });
    expect(here.status).toBe(201);

    const there = await otherApp.request('/v1/admin/settings/units', {
      method: 'POST',
      headers: otherHeaders,
      body: JSON.stringify({ code: 'oz', label: 'Ounces', symbol: 'oz', dimension: 'MASS' }),
    });
    expect(there.status).toBe(201);
  });

  it('requires settings:update, not just settings:read', async () => {
    const role = await seedRole(prisma, businessId, {
      key: 'READ_ONLY_SETTINGS',
      permissionKeys: ['settings:read'],
    });
    const plainAdmin = await seedAdminUser(prisma, businessId, { roleIds: [role.id] });
    const plainHeaders = (await loginAsAdmin(app, plainAdmin)).headers;

    const res = await app.request('/v1/admin/settings/units', {
      method: 'POST',
      headers: plainHeaders,
      body: JSON.stringify({ code: 'oz', label: 'Ounces', symbol: 'oz', dimension: 'MASS' }),
    });
    expect(res.status).toBe(403);
  });
});

describe('PATCH /v1/admin/settings/units/:id — deactivation safety', () => {
  async function createUnit(code = 'oz') {
    const res = await app.request('/v1/admin/settings/units', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ code, label: 'Ounces', symbol: 'oz', dimension: 'MASS' }),
    });
    return (await res.json()) as { id: string; code: string };
  }

  async function seedProductWithVariant(unitCode: string) {
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
    await prisma.productVariant.create({
      data: {
        id: testId(),
        businessId,
        productId: product.id,
        sku: `SKU-${testId()}`,
        name: 'Variant',
        unit: unitCode,
        unitValue: 1,
        pricePaise: 10_000n,
        availability: 'AVAILABLE',
        isDefault: true,
      },
    });
  }

  it('deactivates a unit with no existing variant references', async () => {
    const unit = await createUnit('oz');

    const res = await app.request(`/v1/admin/settings/units/${unit.id}`, {
      method: 'PATCH',
      headers: adminHeaders,
      body: JSON.stringify({ is_active: false }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { is_active: boolean };
    expect(body.is_active).toBe(false);
  });

  it('refuses to deactivate a unit referenced by an existing variant, with 409 UNIT_IN_USE', async () => {
    const unit = await createUnit('oz');
    await seedProductWithVariant('oz');

    const res = await app.request(`/v1/admin/settings/units/${unit.id}`, {
      method: 'PATCH',
      headers: adminHeaders,
      body: JSON.stringify({ is_active: false }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('UNIT_IN_USE');

    const row = await prisma.unit.findUniqueOrThrow({ where: { id: unit.id } });
    expect(row.isActive).toBe(true);
  });

  it('can edit label/symbol without touching active status', async () => {
    const unit = await createUnit('oz');

    const res = await app.request(`/v1/admin/settings/units/${unit.id}`, {
      method: 'PATCH',
      headers: adminHeaders,
      body: JSON.stringify({ label: 'Fluid Ounces' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { label: string; is_active: boolean };
    expect(body.label).toBe('Fluid Ounces');
    expect(body.is_active).toBe(true);
  });

  it('404s for a unit id from a different business', async () => {
    const otherBusiness = await seedBusiness(prisma, { slug: 'admin-settings-it-other2' });
    const otherUnit = await prisma.unit.create({
      data: {
        id: testId(),
        businessId: otherBusiness.id,
        code: 'oz',
        label: 'Ounces',
        symbol: 'oz',
        dimension: 'MASS',
      },
    });

    const res = await app.request(`/v1/admin/settings/units/${otherUnit.id}`, {
      method: 'PATCH',
      headers: adminHeaders,
      body: JSON.stringify({ is_active: false }),
    });
    expect(res.status).toBe(404);
  });
});

describe('a variant create/update rejects a unit that is not an active, configured unit for the business', () => {
  it('rejects at creation (422 INVALID_UNIT)', async () => {
    await app.request('/v1/admin/settings/units', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ code: 'oz', label: 'Ounces', symbol: 'oz', dimension: 'MASS' }),
    });
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

    const res = await app.request(`/v1/admin/products/${product.id}/variants`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        sku: 'SKU-BADUNIT',
        name: 'Bad unit',
        unit: 'not-a-real-unit',
        unit_value: 1,
        price_paise: 10_000,
      }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_UNIT');
  });

  it('accepts a unit created through Settings', async () => {
    await app.request('/v1/admin/settings/units', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ code: 'oz', label: 'Ounces', symbol: 'oz', dimension: 'MASS' }),
    });
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

    const res = await app.request(`/v1/admin/products/${product.id}/variants`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        sku: 'SKU-GOODUNIT',
        name: 'Good unit',
        unit: 'oz',
        unit_value: 1,
        price_paise: 10_000,
      }),
    });
    expect(res.status).toBe(201);
  });
});

describe('catalogue tax-rate ceiling', () => {
  it('defaults to 2800bps (28%) when never configured', async () => {
    const res = await app.request('/v1/admin/settings/catalogue', { headers: adminHeaders });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { max_tax_rate_bps: number };
    expect(body.max_tax_rate_bps).toBe(2800);
  });

  it('can be updated, and persists across requests', async () => {
    const update = await app.request('/v1/admin/settings/catalogue', {
      method: 'PATCH',
      headers: adminHeaders,
      body: JSON.stringify({ max_tax_rate_bps: 1800 }),
    });
    expect(update.status).toBe(200);

    const read = await app.request('/v1/admin/settings/catalogue', { headers: adminHeaders });
    const body = (await read.json()) as { max_tax_rate_bps: number };
    expect(body.max_tax_rate_bps).toBe(1800);
  });

  it('rejects a value above 10000 (100%) at the schema layer', async () => {
    const res = await app.request('/v1/admin/settings/catalogue', {
      method: 'PATCH',
      headers: adminHeaders,
      body: JSON.stringify({ max_tax_rate_bps: 10_001 }),
    });
    expect(res.status).toBe(422);
  });

  it('a variant create is refused once its tax_rate_bps exceeds the configured ceiling', async () => {
    await app.request('/v1/admin/settings/catalogue', {
      method: 'PATCH',
      headers: adminHeaders,
      body: JSON.stringify({ max_tax_rate_bps: 500 }),
    });
    await app.request('/v1/admin/settings/units', {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ code: 'oz', label: 'Ounces', symbol: 'oz', dimension: 'MASS' }),
    });
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

    const res = await app.request(`/v1/admin/products/${product.id}/variants`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        sku: 'SKU-TAXCEIL',
        name: 'Over ceiling',
        unit: 'oz',
        unit_value: 1,
        price_paise: 10_000,
        tax_rate_bps: 2800,
      }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_FAILED');
  });
});
