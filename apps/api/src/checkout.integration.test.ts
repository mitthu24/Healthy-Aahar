import type { ServerEnv } from '@healthy-aahar/config/env/server';
import { now } from '@healthy-aahar/core';
import type { PrismaClient } from '@healthy-aahar/db';
import {
  createTestClient,
  seedBusiness,
  seedCustomerUser,
  setupTestDatabase,
  testId,
  truncateAll,
} from '@healthy-aahar/db/testing';
import { createLogger } from '@healthy-aahar/observability';
import type { Hono } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import type { AppBindings } from './types.js';

/**
 * PHASE 04 — checkout and auto-confirmation, against a real database.
 *
 * Covers the Phase 04 requirement change: a successful COD checkout must
 * land CONFIRMED (not PENDING) atomically, a genuine stock failure must
 * create nothing at all, and a repeated request with the same
 * Idempotency-Key must never create a second order.
 */

let prisma: PrismaClient;
let app: Hono<AppBindings>;
let businessId: string;

function testEnv(): ServerEnv {
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
    RATE_LIMIT_ENABLED: false,
    RATE_LIMIT_READ_PER_MIN: 1000,
    RATE_LIMIT_WRITE_PER_MIN: 1000,
    API_BASE_URL: 'http://localhost:4000',
  } as ServerEnv;
}

async function seedOrderableProduct(
  overrides: {
    pricePaise?: bigint;
    quantityOnHand?: number;
    allowBackorder?: boolean;
    maxOrderQuantity?: number | null;
  } = {},
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
      pricePaise: overrides.pricePaise ?? 15_000n,
      availability: 'AVAILABLE',
      isDefault: true,
      maxOrderQuantity: overrides.maxOrderQuantity ?? null,
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
      trackInventory: true,
      allowBackorder: overrides.allowBackorder ?? false,
    },
  });
  return { product, variant };
}

async function seedDeliverySetup() {
  const city = await prisma.city.create({
    data: {
      id: testId(),
      businessId,
      name: 'Test City',
      slug: `test-city-${testId()}`,
      state: 'Test State',
      status: 'ACTIVE',
      activatedAt: now(),
    },
  });
  const zone = await prisma.deliveryZone.create({
    data: {
      id: testId(),
      businessId,
      cityId: city.id,
      name: 'Zone A',
      code: `ZONE-${testId()}`,
      isActive: true,
    },
  });
  const pincode = String(500000 + Math.floor(Math.random() * 90000));
  await prisma.servicePincode.create({
    data: {
      id: testId(),
      businessId,
      cityId: city.id,
      pincode,
      status: 'ACTIVE',
      activatedAt: now(),
      deliveryZoneId: zone.id,
    },
  });
  const slot = await prisma.deliverySlot.create({
    data: {
      id: testId(),
      businessId,
      name: 'Morning',
      code: `SLOT-${testId()}`,
      startTime: new Date('1970-01-01T09:00:00.000Z'),
      endTime: new Date('1970-01-01T12:00:00.000Z'),
      cutoffTime: new Date('1970-01-01T20:00:00.000Z'),
      availableDays: [0, 1, 2, 3, 4, 5, 6],
      defaultCapacity: 50,
      isActive: true,
    },
  });
  await prisma.slotZoneAssignment.create({
    data: { id: testId(), deliverySlotId: slot.id, deliveryZoneId: zone.id, isActive: true },
  });

  return { pincode, slot };
}

async function registerCustomerAndGetToken(email: string) {
  const { password } = await seedCustomerUser(prisma, businessId, { email });
  const login = await app.request('/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const { token } = (await login.json()) as { token: string };
  return token;
}

async function createAddress(token: string, pincode: string) {
  const res = await app.request('/v1/me/addresses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      recipient_name: 'Test Customer',
      recipient_phone: '+919876543210',
      line1: '123 Test Street',
      city: 'Test City',
      state: 'Test State',
      pincode,
    }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; delivery_zone_id: string | null };
}

async function addToCart(token: string, variantId: string, quantity: number) {
  const res = await app.request('/v1/me/cart/items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ variant_id: variantId, quantity }),
  });
  expect(res.status).toBe(200);
}

function checkout(token: string, body: unknown, idempotencyKey: string) {
  return app.request('/v1/me/orders', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  const url = await setupTestDatabase();
  process.env.DATABASE_URL = url;
  prisma = createTestClient(url);
  app = createApp({
    env: testEnv(),
    prisma,
    logger: createLogger({
      service: 'checkout-it',
      env: 'local',
      version: 'test',
      level: 'silent',
    }),
    businessId: '',
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await truncateAll(prisma);
  const business = await seedBusiness(prisma);
  businessId = business.id;
  app = createApp({
    env: testEnv(),
    prisma,
    logger: createLogger({
      service: 'checkout-it',
      env: 'local',
      version: 'test',
      level: 'silent',
    }),
    businessId,
  });
});

describe('checkout auto-confirmation (Phase 04 requirement change)', () => {
  it('a successful COD checkout lands CONFIRMED, atomically, with a confirmation payload', async () => {
    const { variant } = await seedOrderableProduct({ quantityOnHand: 10 });
    const { pincode, slot } = await seedDeliverySetup();
    const token = await registerCustomerAndGetToken('confirm-flow@example.test');
    const address = await createAddress(token, pincode);
    expect(address.delivery_zone_id).not.toBeNull();
    await addToCart(token, variant.id, 2);

    const res = await checkout(
      token,
      { address_id: address.id, delivery_slot_id: slot.id, service_date: '2026-12-01' },
      'checkout-key-1',
    );

    expect(res.status).toBe(201);
    const order = (await res.json()) as {
      id: string;
      status: string;
      display_status: string;
      payment_method: string;
      payment_status: string;
      items: unknown[];
      total: { amount_paise: number };
      delivery_address: { line1: string };
    };

    expect(order.status).toBe('CONFIRMED');
    expect(order.display_status).toBe('Confirmed');
    expect(order.payment_method).toBe('COD');
    expect(order.payment_status).toBe('DUE');
    expect(order.items).toHaveLength(1);
    expect(order.total.amount_paise).toBeGreaterThan(0);
    expect(order.delivery_address.line1).toBe('123 Test Street');

    const dbOrder = await prisma.order.findUnique({ where: { id: order.id } });
    expect(dbOrder?.status).toBe('CONFIRMED');
    expect(dbOrder?.confirmedAt).not.toBeNull();

    const history = await prisma.orderStatusHistory.findMany({
      where: { orderId: order.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(history.map((h) => h.toStatus)).toEqual(['PENDING', 'CONFIRMED']);
    expect(history[1]?.actorType).toBe('SYSTEM');

    const inventory = await prisma.inventory.findUnique({
      where: { variantId_locationCode: { variantId: variant.id, locationCode: 'MAIN' } },
    });
    expect(inventory?.quantityReserved).toBe(2);

    const cart = await prisma.cart.findUnique({
      where: { customerProfileId: dbOrder!.customerProfileId },
      include: { items: true },
    });
    expect(cart?.items).toHaveLength(0);

    const notifications = await prisma.notification.findMany({
      where: { type: 'ORDER_CONFIRMED' },
    });
    expect(notifications).toHaveLength(1);
  });

  it('insufficient stock fails cleanly and creates no order, no reservation, no false confirmation', async () => {
    const { variant } = await seedOrderableProduct({ quantityOnHand: 1 });
    const { pincode, slot } = await seedDeliverySetup();
    const token = await registerCustomerAndGetToken('stock-fail@example.test');
    const address = await createAddress(token, pincode);
    await addToCart(token, variant.id, 5); // more than the 1 on hand

    const res = await checkout(
      token,
      { address_id: address.id, delivery_slot_id: slot.id, service_date: '2026-12-01' },
      'checkout-key-stock-fail',
    );

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INSUFFICIENT_STOCK');

    expect(await prisma.order.count()).toBe(0);
    const inventory = await prisma.inventory.findUnique({
      where: { variantId_locationCode: { variantId: variant.id, locationCode: 'MAIN' } },
    });
    expect(inventory?.quantityReserved).toBe(0);
  });

  it('a repeated request with the same Idempotency-Key never creates a second order', async () => {
    const { variant } = await seedOrderableProduct({ quantityOnHand: 10 });
    const { pincode, slot } = await seedDeliverySetup();
    const token = await registerCustomerAndGetToken('idempotent-flow@example.test');
    const address = await createAddress(token, pincode);
    await addToCart(token, variant.id, 1);

    const payload = {
      address_id: address.id,
      delivery_slot_id: slot.id,
      service_date: '2026-12-01',
    };

    const first = await checkout(token, payload, 'checkout-key-dup');
    expect(first.status).toBe(201);
    const firstOrder = (await first.json()) as { id: string };

    // A genuine retry resends the identical body with the same key — the
    // cart is already empty at this point, which is exactly why this must
    // NOT re-validate against an empty cart and fail; it must short-circuit
    // to the original result.
    const second = await checkout(token, payload, 'checkout-key-dup');
    expect(second.status).toBe(201);
    const secondOrder = (await second.json()) as { id: string };

    expect(secondOrder.id).toBe(firstOrder.id);
    expect(await prisma.order.count()).toBe(1);
  });

  it('reusing the same Idempotency-Key with a DIFFERENT payload is rejected, not silently honoured', async () => {
    const { variant } = await seedOrderableProduct({ quantityOnHand: 10 });
    const { pincode, slot } = await seedDeliverySetup();
    const token = await registerCustomerAndGetToken('idempotent-reuse@example.test');
    const address = await createAddress(token, pincode);
    await addToCart(token, variant.id, 1);

    const first = await checkout(
      token,
      { address_id: address.id, delivery_slot_id: slot.id, service_date: '2026-12-01' },
      'checkout-key-reuse',
    );
    expect(first.status).toBe(201);

    await addToCart(token, variant.id, 1);
    const second = await checkout(
      token,
      { address_id: address.id, delivery_slot_id: slot.id, service_date: '2026-12-02' },
      'checkout-key-reuse',
    );

    expect(second.status).toBe(422);
    const body = (await second.json()) as { error: { code: string } };
    expect(body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await prisma.order.count()).toBe(1);
  });
});
