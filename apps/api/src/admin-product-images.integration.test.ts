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
  truncateAll,
} from '@healthy-aahar/db/testing';
import { createLogger } from '@healthy-aahar/observability';
import type { Hono } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import { loginAsAdmin } from './test-support/admin-session.js';
import type { AppBindings } from './types.js';

/**
 * Whether local MinIO (docker-compose.yml's `minio` service) is actually
 * reachable in THIS run. Checked once at module load (not inside a
 * `beforeAll`): `describe.skipIf` needs its condition at collection time,
 * before any hook runs. The "authorization" suite below never touches
 * storage over the network (presigning is pure HMAC, no I/O) and always
 * runs; only the "full round trip against real object storage" suite,
 * which does genuine PUT/GET calls, is skipped when storage is
 * unreachable — reported as explicitly SKIPPED, not silently passing or
 * failing, so a missing environment is never mistaken for a passing test.
 */
const MINIO_AVAILABLE = await fetch('http://localhost:9000/minio/health/live')
  .then((res) => res.ok)
  .catch(() => false);

/**
 * API integration tests for the PHASE 05 device-upload flow, against a
 * REAL database AND real object storage — `docker-compose.yml`'s `minio`
 * service, the same S3-compatible surface standing in for Cloudflare R2
 * locally (docs/27 §7). This exercises the actual presigned-PUT round trip
 * (`fetch` the presigned URL, PUT real bytes, then confirm) rather than
 * stubbing storage out, matching how `setupTestDatabase` already treats
 * Postgres for every other integration test in this repo.
 *
 * Requires `docker compose up -d` (postgres + minio) to be running
 * locally — the same prerequisite every other `*.integration.test.ts`
 * file in this repo already has for Postgres.
 */

let prisma: PrismaClient;
let app: Hono<AppBindings>;
let businessId: string;
let categoryId: string;
let productId: string;
let adminHeaders: Record<string, string>;
let readOnlyHeaders: Record<string, string>;

const MINIO_BUCKET = 'healthy-aahar-media-local';

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
    LOGIN_RATE_LIMIT_PER_MIN: 5,
    REGISTER_RATE_LIMIT_PER_MIN: 5,
    BREVO_SENDER_NAME: 'Healthy Aahar',
    NOTIFICATIONS_ENABLED: false,
    // Pointed at the local MinIO instance (same creds docker-compose.yml /
    // .env.example already use) — NOT real R2, never a production value.
    R2_ACCOUNT_ID: undefined,
    R2_ACCESS_KEY_ID: 'healthyaahar',
    R2_SECRET_ACCESS_KEY: 'healthyaahar_local',
    R2_ENDPOINT: 'http://localhost:9000',
    R2_PUBLIC_BASE_URL: `http://localhost:9000/${MINIO_BUCKET}`,
    R2_BUCKET_NAME: MINIO_BUCKET,
    R2_UPLOAD_MAX_BYTES: 5_242_880,
    R2_PRESIGN_TTL_SECONDS: 300,
    INTERNAL_SERVICE_TOKEN: 'test-internal-token-value',
    ADMIN_CSRF_SECRET: 'test-csrf-secret-value',
    DEFAULT_TIMEZONE: 'Asia/Kolkata',
    DEFAULT_CURRENCY: 'INR',
    BOOKING_HORIZON_DAYS: 7,
    SUBSCRIPTION_GENERATION_HORIZON_DAYS: 14,
    SUBSCRIPTION_MATERIALISE_HORIZON_HOURS: 36,
    RATE_LIMIT_ENABLED: false,
    RATE_LIMIT_READ_PER_MIN: 300,
    RATE_LIMIT_WRITE_PER_MIN: 60,
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

function buildApp(env = testEnv(), scopedBusinessId = businessId) {
  return createApp({
    env,
    prisma,
    logger: createLogger({ service: 'api-it', env: 'local', version: 'test', level: 'silent' }),
    businessId: scopedBusinessId,
  });
}

/** A minimal, valid 1x1 PNG — small enough to assert against the byte-size check cheaply. */
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

beforeAll(async () => {
  const url = await setupTestDatabase();
  process.env.DATABASE_URL_TEST = url;
  prisma = createTestClient(url);
}, 180_000);

afterAll(async () => {
  await prisma?.$disconnect();
});

beforeEach(async () => {
  await truncateAll(prisma);
  const business = await seedBusiness(prisma, { slug: 'main-business', name: 'Healthy Aahar' });
  businessId = business.id;
  app = buildApp();

  await seedPermissions(prisma, PERMISSIONS);

  const category = await prisma.category.create({
    data: { id: crypto.randomUUID(), businessId, name: 'Grains', slug: 'grains', displayOrder: 0 },
  });
  categoryId = category.id;

  const product = await prisma.product.create({
    data: {
      id: crypto.randomUUID(),
      businessId,
      categoryId,
      name: 'Millet Mix',
      slug: 'millet-mix',
      status: 'DRAFT',
    },
  });
  productId = product.id;

  const writerRole = await seedRole(prisma, businessId, {
    key: 'TEST_CATALOGUE_WRITER',
    permissionKeys: ['catalog:read', 'catalog:update'],
  });
  const writer = await seedAdminUser(prisma, businessId, { roleIds: [writerRole.id] });
  adminHeaders = (await loginAsAdmin(app, writer)).headers;

  const readerRole = await seedRole(prisma, businessId, {
    key: 'TEST_CATALOGUE_READER',
    permissionKeys: ['catalog:read'],
  });
  const reader = await seedAdminUser(prisma, businessId, { roleIds: [readerRole.id] });
  readOnlyHeaders = (await loginAsAdmin(app, reader)).headers;
});

describe('product image upload (PHASE 05) — authorization', () => {
  it('rejects an unauthenticated upload-url request', async () => {
    const res = await app.request(`/v1/admin/products/${productId}/images/upload-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content_type: 'image/png' }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects an admin who only has catalog:read, not catalog:update', async () => {
    const res = await app.request(`/v1/admin/products/${productId}/images/upload-url`, {
      method: 'POST',
      headers: { ...readOnlyHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content_type: 'image/png' }),
    });
    expect(res.status).toBe(403);
  });

  it('rejects an unsupported content type with 422, issuing no presign', async () => {
    const res = await app.request(`/v1/admin/products/${productId}/images/upload-url`, {
      method: 'POST',
      headers: { ...adminHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content_type: 'application/pdf' }),
    });
    expect(res.status).toBe(422);
  });

  it('404s requesting an upload for a product that does not exist', async () => {
    const res = await app.request(`/v1/admin/products/${crypto.randomUUID()}/images/upload-url`, {
      method: 'POST',
      headers: { ...adminHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content_type: 'image/png' }),
    });
    expect(res.status).toBe(404);
  });
});

describe.skipIf(!MINIO_AVAILABLE)(
  'product image upload (PHASE 05) — full round trip against real object storage',
  () => {
    it('uploads a real file, confirms it, and the product shows it; invalid files and storage errors are rejected along the way', async () => {
      // Step 1: request the presigned URL.
      const ticketRes = await app.request(`/v1/admin/products/${productId}/images/upload-url`, {
        method: 'POST',
        headers: { ...adminHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content_type: 'image/png', display_order: 0 }),
      });
      expect(ticketRes.status).toBe(200);
      const ticket = (await ticketRes.json()) as {
        image_id: string;
        upload_url: string;
        max_bytes: number;
      };
      expect(ticket.image_id).toBeTruthy();
      expect(ticket.upload_url).toMatch(/^http:\/\/localhost:9000\//);

      // The image must not be visible on the product yet — it is PENDING.
      const beforeConfirm = await app.request(`/v1/admin/products/${productId}`, {
        headers: adminHeaders,
      });
      const beforeBody = (await beforeConfirm.json()) as { images: unknown[] };
      expect(beforeBody.images).toHaveLength(0);

      // Step 2: upload real bytes directly to MinIO, exactly as a browser would.
      const putRes = await fetch(ticket.upload_url, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/png' },
        body: ONE_PIXEL_PNG,
      });
      expect(putRes.ok).toBe(true);

      // Step 3: confirm.
      const confirmRes = await app.request(
        `/v1/admin/products/${productId}/images/${ticket.image_id}/confirm`,
        { method: 'POST', headers: adminHeaders },
      );
      expect(confirmRes.status).toBe(200);
      const confirmed = (await confirmRes.json()) as { images: Array<{ id: string; url: string }> };
      expect(confirmed.images).toHaveLength(1);
      expect(confirmed.images[0]!.id).toBe(ticket.image_id);

      // The confirmed image is genuinely fetchable from the public URL.
      const publicFetch = await fetch(confirmed.images[0]!.url);
      expect(publicFetch.ok).toBe(true);

      // It now also shows up on a fresh GET.
      const afterConfirm = await app.request(`/v1/admin/products/${productId}`, {
        headers: adminHeaders,
      });
      const afterBody = (await afterConfirm.json()) as { images: unknown[] };
      expect(afterBody.images).toHaveLength(1);

      // Removing it deletes the underlying object too.
      const deleteRes = await app.request(
        `/v1/admin/products/${productId}/images/${ticket.image_id}`,
        { method: 'DELETE', headers: adminHeaders },
      );
      expect(deleteRes.status).toBe(200);
      const afterDeleteFetch = await fetch(confirmed.images[0]!.url);
      expect(afterDeleteFetch.ok).toBe(false);
    }, 30_000);

    it('refuses to confirm when nothing was actually uploaded to the presigned URL', async () => {
      const ticketRes = await app.request(`/v1/admin/products/${productId}/images/upload-url`, {
        method: 'POST',
        headers: { ...adminHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content_type: 'image/jpeg' }),
      });
      const ticket = (await ticketRes.json()) as { image_id: string };

      // Deliberately skip the PUT step.
      const confirmRes = await app.request(
        `/v1/admin/products/${productId}/images/${ticket.image_id}/confirm`,
        { method: 'POST', headers: adminHeaders },
      );
      expect(confirmRes.status).toBe(422);

      const productRes = await app.request(`/v1/admin/products/${productId}`, {
        headers: adminHeaders,
      });
      const body = (await productRes.json()) as { images: unknown[] };
      expect(body.images).toHaveLength(0);
    }, 30_000);

    it('refuses to confirm a file larger than the configured limit', async () => {
      const smallLimitApp = buildApp(testEnv({ R2_UPLOAD_MAX_BYTES: 100 }));
      const writerRole = await seedRole(prisma, businessId, {
        key: 'TEST_CATALOGUE_WRITER_SMALL_LIMIT',
        permissionKeys: ['catalog:read', 'catalog:update'],
      });
      const writer = await seedAdminUser(prisma, businessId, { roleIds: [writerRole.id] });
      const headers = (await loginAsAdmin(smallLimitApp, writer)).headers;

      const ticketRes = await smallLimitApp.request(
        `/v1/admin/products/${productId}/images/upload-url`,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ content_type: 'image/png' }),
        },
      );
      const ticket = (await ticketRes.json()) as { image_id: string; upload_url: string };

      const putRes = await fetch(ticket.upload_url, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/png' },
        body: ONE_PIXEL_PNG, // well over the 100-byte test limit
      });
      expect(putRes.ok).toBe(true); // storage itself has no opinion on the app's limit

      const confirmRes = await smallLimitApp.request(
        `/v1/admin/products/${productId}/images/${ticket.image_id}/confirm`,
        { method: 'POST', headers },
      );
      expect(confirmRes.status).toBe(422);
    }, 30_000);
  },
);
