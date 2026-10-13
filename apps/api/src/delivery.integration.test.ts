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
 * PHASE 06 — delivery partners + order assignment, against a real database.
 * Exercises the real `/v1/admin/delivery-partners`, `/v1/admin/orders/{id}
 * /assign` and `/v1/admin/delivery/*` routes end to end: partner creation,
 * assignment rules (off-duty/suspended rejection, reassignment requiring a
 * reason), the partner's own duty toggle and delivery lifecycle, ownership
 * scoping (never leaking an order's existence to a non-assigned partner),
 * COD collection, and tenant isolation.
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
      service: 'delivery-it',
      env: 'local',
      version: 'test',
      level: 'silent',
    }),
    businessId: scopedBusinessId,
  });
}

/** Seeds a minimal Order directly (bypassing checkout — not what this file tests) in a given status. */
async function seedTestOrder(
  scopedBusinessId: string,
  overrides: { status?: 'READY_FOR_DISPATCH' | 'OUT_FOR_DELIVERY' | 'DELIVERED' } = {},
) {
  const customer = await seedCustomerUser(prisma, scopedBusinessId);
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

  const order = await prisma.order.create({
    data: {
      id: testId(),
      businessId: scopedBusinessId,
      orderNumber: `ORD-TEST-${testId()}`,
      customerProfileId: customer.profileId,
      status: overrides.status ?? 'READY_FOR_DISPATCH',
      deliverySlotId: slot.id,
      serviceDate: now(),
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
      subtotalPaise: 10_000n,
      totalPaise: 10_000n,
      paymentMethod: 'COD',
      paymentStatus: 'DUE',
    },
  });

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

let superAdminHeaders: Record<string, string>;
let deliveryRoleId: string;

beforeEach(async () => {
  await truncateAll(prisma);
  const business = await seedBusiness(prisma, { slug: 'delivery-it', name: 'Healthy Aahar' });
  businessId = business.id;
  await seedPermissions(prisma, PERMISSIONS);
  app = buildApp();

  const superAdmin = await seedAdminUser(prisma, businessId, {
    isSuperAdmin: true,
    fullName: 'Root Admin',
  });
  superAdminHeaders = (await loginAsAdmin(app, superAdmin)).headers;

  const role = await seedRole(prisma, businessId, {
    key: 'DELIVERY_PARTNER',
    permissionKeys: ['deliveries:fulfil'],
  });
  deliveryRoleId = role.id;
});

async function createPartner(email: string) {
  const res = await app.request('/v1/admin/delivery-partners', {
    method: 'POST',
    headers: superAdminHeaders,
    body: JSON.stringify({ email, full_name: 'Test Partner' }),
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { id: string; password_setup_link: string };
  return body;
}

describe('delivery partner accounts (admin-managed)', () => {
  it('creates a delivery partner as an AdminUser with the DELIVERY_PARTNER role', async () => {
    const created = await createPartner('rider@example.test');

    const admin = await prisma.adminUser.findUniqueOrThrow({
      where: { id: created.id },
      include: { roles: { include: { role: true } } },
    });
    expect(admin.roles.map((r) => r.role.key)).toContain('DELIVERY_PARTNER');

    const profile = await prisma.deliveryPartnerProfile.findUniqueOrThrow({
      where: { adminUserId: created.id },
    });
    expect(profile.dutyStatus).toBe('OFF_DUTY');
  });

  it('a non-manager cannot create a delivery partner (403)', async () => {
    const plainRole = await seedRole(prisma, businessId, {
      key: 'PLAIN',
      permissionKeys: ['orders:read'],
    });
    const plainAdmin = await seedAdminUser(prisma, businessId, { roleIds: [plainRole.id] });
    const plainHeaders = (await loginAsAdmin(app, plainAdmin)).headers;

    const res = await app.request('/v1/admin/delivery-partners', {
      method: 'POST',
      headers: plainHeaders,
      body: JSON.stringify({ email: 'rider2@example.test', full_name: 'Rider Two' }),
    });
    expect(res.status).toBe(403);
  });

  it('suspending a partner marks the account deactivated and revokes their active session', async () => {
    const partner = await seedAdminUser(prisma, businessId, {
      email: 'rider3@example.test',
      roleIds: [deliveryRoleId],
    });
    await prisma.deliveryPartnerProfile.create({
      data: { id: testId(), businessId, adminUserId: partner.id, dutyStatus: 'ON_DUTY' },
    });
    const partnerHeaders = (await loginAsAdmin(app, partner)).headers;

    // Confirm the session works before suspension, to prove what follows is
    // the suspension's effect and not a pre-existing auth failure.
    const beforeRes = await app.request('/v1/admin/delivery/me', { headers: partnerHeaders });
    expect(beforeRes.status).toBe(200);

    const suspendRes = await app.request(`/v1/admin/delivery-partners/${partner.id}/suspend`, {
      method: 'POST',
      headers: superAdminHeaders,
    });
    expect(suspendRes.status).toBe(200);
    const body = (await suspendRes.json()) as { deactivated: boolean };
    expect(body.deactivated).toBe(true);

    // BR-SEC10 (reused from RbacService.deactivate): the SAME session cookie
    // that worked a moment ago must be rejected now.
    const afterRes = await app.request('/v1/admin/delivery/me', { headers: partnerHeaders });
    expect(afterRes.status).toBe(401);
  });
});

describe('order assignment (admin side)', () => {
  it('assigns a READY_FOR_DISPATCH order to an on-duty partner', async () => {
    const order = await seedTestOrder(businessId);
    const partner = await seedAdminUser(prisma, businessId, { roleIds: [deliveryRoleId] });
    await prisma.deliveryPartnerProfile.create({
      data: { id: testId(), businessId, adminUserId: partner.id, dutyStatus: 'ON_DUTY' },
    });

    const res = await app.request(`/v1/admin/orders/${order.id}/assign`, {
      method: 'POST',
      headers: superAdminHeaders,
      body: JSON.stringify({ partner_admin_user_id: partner.id }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { assigned_partner_id: string };
    expect(body.assigned_partner_id).toBe(partner.id);
  });

  it('refuses to assign to an off-duty partner (409)', async () => {
    const order = await seedTestOrder(businessId);
    const partner = await seedAdminUser(prisma, businessId, { roleIds: [deliveryRoleId] });
    await prisma.deliveryPartnerProfile.create({
      data: { id: testId(), businessId, adminUserId: partner.id, dutyStatus: 'OFF_DUTY' },
    });

    const res = await app.request(`/v1/admin/orders/${order.id}/assign`, {
      method: 'POST',
      headers: superAdminHeaders,
      body: JSON.stringify({ partner_admin_user_id: partner.id }),
    });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('PARTNER_OFF_DUTY');
  });

  it('requires a reason to reassign, and records both rows in assignment history', async () => {
    const order = await seedTestOrder(businessId);
    const partnerA = await seedAdminUser(prisma, businessId, { roleIds: [deliveryRoleId] });
    const partnerB = await seedAdminUser(prisma, businessId, { roleIds: [deliveryRoleId] });
    for (const p of [partnerA, partnerB]) {
      await prisma.deliveryPartnerProfile.create({
        data: { id: testId(), businessId, adminUserId: p.id, dutyStatus: 'ON_DUTY' },
      });
    }

    await app.request(`/v1/admin/orders/${order.id}/assign`, {
      method: 'POST',
      headers: superAdminHeaders,
      body: JSON.stringify({ partner_admin_user_id: partnerA.id }),
    });

    const noReasonRes = await app.request(`/v1/admin/orders/${order.id}/assign`, {
      method: 'POST',
      headers: superAdminHeaders,
      body: JSON.stringify({ partner_admin_user_id: partnerB.id }),
    });
    expect(noReasonRes.status).toBe(422);

    const reassignRes = await app.request(`/v1/admin/orders/${order.id}/assign`, {
      method: 'POST',
      headers: superAdminHeaders,
      body: JSON.stringify({ partner_admin_user_id: partnerB.id, reason: 'Partner A went sick' }),
    });
    expect(reassignRes.status).toBe(200);

    const historyRes = await app.request(`/v1/admin/orders/${order.id}/assignment-history`, {
      headers: superAdminHeaders,
    });
    const history = (await historyRes.json()) as { data: Array<{ status: string }> };
    expect(history.data).toHaveLength(2);
    expect(history.data.map((h) => h.status).sort()).toEqual(['ACTIVE', 'REASSIGNED']);
  });

  it('refuses to assign an order that is not in an assignable status (409)', async () => {
    const order = await seedTestOrder(businessId, { status: 'DELIVERED' });
    const partner = await seedAdminUser(prisma, businessId, { roleIds: [deliveryRoleId] });
    await prisma.deliveryPartnerProfile.create({
      data: { id: testId(), businessId, adminUserId: partner.id, dutyStatus: 'ON_DUTY' },
    });

    const res = await app.request(`/v1/admin/orders/${order.id}/assign`, {
      method: 'POST',
      headers: superAdminHeaders,
      body: JSON.stringify({ partner_admin_user_id: partner.id }),
    });
    expect(res.status).toBe(409);
  });
});

describe('delivery partner self-service', () => {
  async function seedOnDutyPartner(email: string) {
    const admin = await seedAdminUser(prisma, businessId, {
      email,
      roleIds: [deliveryRoleId],
    });
    await prisma.deliveryPartnerProfile.create({
      data: { id: testId(), businessId, adminUserId: admin.id, dutyStatus: 'ON_DUTY' },
    });
    const headers = (await loginAsAdmin(app, admin)).headers;
    return { admin, headers };
  }

  it('toggles duty status', async () => {
    const { headers } = await seedOnDutyPartner('partner-duty@example.test');

    const res = await app.request('/v1/admin/delivery/duty', {
      method: 'POST',
      headers,
      body: JSON.stringify({ duty_status: 'OFF_DUTY' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { duty_status: string };
    expect(body.duty_status).toBe('OFF_DUTY');
  });

  it('accepts an assignment and completes the delivery lifecycle, including COD collection', async () => {
    const order = await seedTestOrder(businessId);
    const { admin, headers } = await seedOnDutyPartner('partner-flow@example.test');

    await app.request(`/v1/admin/orders/${order.id}/assign`, {
      method: 'POST',
      headers: superAdminHeaders,
      body: JSON.stringify({ partner_admin_user_id: admin.id }),
    });

    const acceptRes = await app.request(`/v1/admin/delivery/orders/${order.id}/accept`, {
      method: 'POST',
      headers,
    });
    expect(acceptRes.status).toBe(200);
    expect(((await acceptRes.json()) as { status: string }).status).toBe('OUT_FOR_DELIVERY');

    const codRes = await app.request(`/v1/admin/delivery/orders/${order.id}/cod-collection`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ amount_paise: 10_000 }),
    });
    expect(codRes.status).toBe(200);
    expect(((await codRes.json()) as { cod_collected: boolean }).cod_collected).toBe(true);

    const doubleCodRes = await app.request(`/v1/admin/delivery/orders/${order.id}/cod-collection`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ amount_paise: 10_000 }),
    });
    expect(doubleCodRes.status).toBe(422);

    const deliveredRes = await app.request(`/v1/admin/delivery/orders/${order.id}/delivered`, {
      method: 'POST',
      headers,
    });
    expect(deliveredRes.status).toBe(200);
    expect(((await deliveredRes.json()) as { status: string }).status).toBe('DELIVERED');
  });

  it('never exposes an order not assigned to the calling partner (404, not 403 — anti-enumeration)', async () => {
    const order = await seedTestOrder(businessId);
    const { admin: owner } = await seedOnDutyPartner('owner@example.test');
    const { headers: otherHeaders } = await seedOnDutyPartner('other@example.test');

    await app.request(`/v1/admin/orders/${order.id}/assign`, {
      method: 'POST',
      headers: superAdminHeaders,
      body: JSON.stringify({ partner_admin_user_id: owner.id }),
    });

    const res = await app.request(`/v1/admin/delivery/orders/${order.id}`, {
      headers: otherHeaders,
    });
    expect(res.status).toBe(404);
  });

  it('rejects an invalid lifecycle transition (cannot mark delivered before dispatch)', async () => {
    const order = await seedTestOrder(businessId);
    const { admin, headers } = await seedOnDutyPartner('partner-invalid@example.test');

    await app.request(`/v1/admin/orders/${order.id}/assign`, {
      method: 'POST',
      headers: superAdminHeaders,
      body: JSON.stringify({ partner_admin_user_id: admin.id }),
    });

    const res = await app.request(`/v1/admin/delivery/orders/${order.id}/delivered`, {
      method: 'POST',
      headers,
    });
    expect(res.status).toBe(409);
  });
});

describe('tenant isolation', () => {
  it('an order in another business is never visible to this one', async () => {
    const otherBusiness = await seedBusiness(prisma, {
      slug: 'delivery-it-other',
      name: 'Other Co',
    });
    const otherOrder = await seedTestOrder(otherBusiness.id);

    const res = await app.request(`/v1/admin/orders/${otherOrder.id}/assign`, {
      method: 'POST',
      headers: superAdminHeaders,
      body: JSON.stringify({ partner_admin_user_id: '0193ffff-0000-7000-8000-000000000001' }),
    });
    expect(res.status).toBe(404);
  });
});
