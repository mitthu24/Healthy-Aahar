import type { ServerEnv } from '@healthy-aahar/config/env/server';
import { buildOpenApiDocument } from '@healthy-aahar/contracts';
import {
  AddressService,
  AdminAuthService,
  AdminCatalogueService,
  AdminDeliverySlotService,
  CartService,
  CatalogueService,
  CheckoutService,
  CustomerAuthService,
  CustomerOrderService,
  OrderFulfilmentService,
  PasswordResetService,
  RbacService,
  ServiceabilityAdminService,
  ServiceabilityService,
} from '@healthy-aahar/core';
import {
  PermissionCache,
  scryptPasswordHasher,
  sha256SessionTokenHasher,
} from '@healthy-aahar/auth';
import type { PrismaClient } from '@healthy-aahar/db';
import type { Logger } from '@healthy-aahar/observability';
import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { assertRegistryIsSound, listRoutes, toOpenApiSpecs } from './lib/route-registry.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { InMemoryRateLimitStore, rateLimit } from './middleware/rate-limit.js';
import { requestId } from './middleware/request-id.js';
import { securityHeaders } from './middleware/security-headers.js';
import { adminAuth } from './middleware/admin-auth.js';
import { csrfProtection } from './middleware/csrf.js';
import { customerAuth } from './middleware/customer-auth.js';
import { requirePermission } from './middleware/require-permission.js';
import {
  PrismaCityRepository,
  PrismaPincodeRepository,
} from './repositories/prisma-serviceability-admin-repository.js';
import { PrismaServiceabilityRepository } from './repositories/prisma-serviceability-repository.js';
import { PrismaAdminRepository } from './repositories/prisma-admin-repository.js';
import { PrismaAuditLogRepository } from './repositories/prisma-audit-log-repository.js';
import { PrismaPasswordResetRepository } from './repositories/prisma-password-reset-repository.js';
import { PrismaRoleRepository } from './repositories/prisma-role-repository.js';
import { PrismaSessionRepository } from './repositories/prisma-session-repository.js';
import { PrismaUserRepository } from './repositories/prisma-user-repository.js';
import { PrismaAddressRepository } from './repositories/prisma-address-repository.js';
import { PrismaCatalogueRepository } from './repositories/prisma-catalogue-repository.js';
import { PrismaCartRepository } from './repositories/prisma-cart-repository.js';
import { PrismaCheckoutRepository } from './repositories/prisma-checkout-repository.js';
import { PrismaOrderRepository } from './repositories/prisma-order-repository.js';
import {
  PrismaAdminCategoryRepository,
  PrismaAdminProductRepository,
  PrismaAdminVariantRepository,
} from './repositories/prisma-admin-catalogue-repository.js';
import { PrismaAdminDeliverySlotRepository } from './repositories/prisma-admin-delivery-slot-repository.js';
import { adminServiceabilityRoutes } from './routes/admin/serviceability.js';
import { adminAuthRoutes } from './routes/admin/auth.js';
import { adminUsersRoutes } from './routes/admin/admin-users.js';
import { adminOrdersRoutes } from './routes/admin/orders.js';
import { adminCatalogueRoutes } from './routes/admin/catalogue.js';
import { adminDeliverySlotsRoutes } from './routes/admin/delivery-slots.js';
import { rolesRoutes } from './routes/admin/roles.js';
import { customerAuthRoutes } from './routes/auth/customer-session.js';
import { passwordSetupRoutes } from './routes/auth/password-setup.js';
import { healthRoutes } from './routes/health.js';
import { publicServiceabilityRoutes } from './routes/public/serviceability.js';
import { publicCatalogueRoutes } from './routes/public/catalogue.js';
import { addressesRoutes } from './routes/me/addresses.js';
import { cartRoutes } from './routes/me/cart.js';
import { deliverySlotsRoutes } from './routes/me/delivery-slots.js';
import { ordersRoutes } from './routes/me/orders.js';
import type { AppBindings } from './types.js';

export type CreateAppOptions = {
  env: ServerEnv;
  prisma: PrismaClient;
  logger: Logger;
  businessId: string;
};

/**
 * Builds the API application.
 *
 * Separated from `server.ts` so integration tests can construct the app with
 * a test database and no listening socket. This is also what makes the
 * "no browser context" suite possible — the suite that proves a native mobile
 * client could call every endpoint (docs/30 §10): PHASE 03 authentication
 * (email/password, DB-backed sessions) needs no external service and no test
 * seam beyond the real test database every other integration test already
 * uses (ADR-028) — there is no Firebase-shaped `authOverrides` any more.
 */
export function createApp(options: CreateAppOptions): Hono<AppBindings> {
  const { env, prisma, logger, businessId } = options;

  // Fail the boot, not a request, if any route is under-declared (BR-SEC12).
  assertRegistryIsSound();

  // ── Repositories (Prisma) ─────────────────────────────────────────────
  const userRepo = new PrismaUserRepository(prisma);
  const adminRepo = new PrismaAdminRepository(prisma);
  const roleRepo = new PrismaRoleRepository(prisma);
  const auditRepo = new PrismaAuditLogRepository(prisma);
  const sessionRepo = new PrismaSessionRepository(prisma);
  const passwordResetRepo = new PrismaPasswordResetRepository(prisma);

  const permissionCache = new PermissionCache();
  void permissionCache; // Reserved for a future cached AdminRepository decorator; resolveActor already re-queries per request, which is correct but not yet cache-backed (see PHASE-03 report §"Known limitations").

  // Constructed before `rbac` — RbacService delegates ALL token issuance to
  // it (Fix #2: one authorized-issuance workflow, not two copies of the
  // same logic in RbacService and here).
  const passwordReset = new PasswordResetService(
    userRepo,
    passwordResetRepo,
    sessionRepo,
    scryptPasswordHasher,
    sha256SessionTokenHasher,
  );

  const services = {
    serviceability: new ServiceabilityService({
      repository: new PrismaServiceabilityRepository(prisma),
      brandName: 'Healthy Aahar',
    }),
    serviceabilityAdmin: new ServiceabilityAdminService({
      cities: new PrismaCityRepository(prisma),
      pincodes: new PrismaPincodeRepository(prisma),
    }),
    customerAuth: new CustomerAuthService(
      userRepo,
      sessionRepo,
      scryptPasswordHasher,
      sha256SessionTokenHasher,
    ),
    adminAuth: new AdminAuthService(
      adminRepo,
      userRepo,
      sessionRepo,
      scryptPasswordHasher,
      sha256SessionTokenHasher,
    ),
    rbac: new RbacService(adminRepo, roleRepo, passwordReset, sessionRepo, auditRepo),
    passwordReset,
    catalogue: new CatalogueService({ catalogue: new PrismaCatalogueRepository(prisma) }),
    address: new AddressService({ addresses: new PrismaAddressRepository(prisma) }),
    cart: new CartService({ carts: new PrismaCartRepository(prisma) }),
    checkout: new CheckoutService({ checkout: new PrismaCheckoutRepository(prisma) }),
    customerOrders: new CustomerOrderService({ orders: new PrismaOrderRepository(prisma) }),
    orderFulfilment: new OrderFulfilmentService({ orders: new PrismaOrderRepository(prisma) }),
    adminCatalogue: new AdminCatalogueService({
      categories: new PrismaAdminCategoryRepository(prisma),
      products: new PrismaAdminProductRepository(prisma),
      variants: new PrismaAdminVariantRepository(prisma),
      audit: auditRepo,
    }),
    adminDeliverySlots: new AdminDeliverySlotService({
      slots: new PrismaAdminDeliverySlotRepository(prisma),
      audit: auditRepo,
    }),
  };

  const app = new Hono<AppBindings>();

  const loginRateLimitStore = new InMemoryRateLimitStore();

  // Dependencies are attached per request rather than imported as module
  // singletons, which is what lets tests run against an isolated database.
  app.use('*', async (c, next) => {
    c.env = {
      ...c.env,
      env,
      prisma,
      services,
      businessId,
      auth: { permissionCache, loginRateLimitStore },
    };
    await next();
  });

  app.use('*', requestId);
  app.use('*', securityHeaders);

  app.use('*', async (c, next) => {
    c.set(
      'logger',
      logger.child({
        request_id: c.get('requestId'),
        route: `${c.req.method} ${c.req.path}`,
      }),
    );
    c.set('actor', { kind: 'ANONYMOUS' });
    await next();
  });

  // Explicit origin allow-list. No wildcard, no regex — the env schema
  // rejects wildcards outright in production (docs/23 §7).
  app.use(
    '*',
    cors({
      origin: (origin) => (env.ALLOWED_ORIGINS.includes(origin) ? origin : null),
      allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: [
        'Authorization',
        'Content-Type',
        'Idempotency-Key',
        'X-Request-Id',
        'X-Client',
        'X-CSRF-Token',
      ],
      exposeHeaders: [
        'X-Request-Id',
        'X-RateLimit-Remaining',
        'X-RateLimit-Reset',
        'Retry-After',
        'X-CSRF-Token',
      ],
      credentials: true,
      maxAge: 86_400,
    }),
  );

  const rateLimitStore = new InMemoryRateLimitStore();

  app.use(
    '/v1/public/*',
    rateLimit({
      store: rateLimitStore,
      limit: env.RATE_LIMIT_READ_PER_MIN,
      enabled: env.RATE_LIMIT_ENABLED,
      bucket: 'public-read',
    }),
  );

  // Request/response log line (docs/28 §2).
  app.use('*', async (c, next) => {
    await next();
    const startedAt = c.get('startedAt');
    c.get('logger')?.info(
      {
        msg: 'request.completed',
        status: c.res.status,
        duration_ms: startedAt ? Math.round(performance.now() - startedAt) : undefined,
      },
      'request completed',
    );
  });

  app.onError(errorHandler);
  app.notFound(notFoundHandler);

  // Admin write limits are tighter than public reads.
  app.use(
    '/v1/admin/*',
    rateLimit({
      store: rateLimitStore,
      limit: env.RATE_LIMIT_WRITE_PER_MIN,
      enabled: env.RATE_LIMIT_ENABLED,
      bucket: 'admin-write',
    }),
  );

  // ── Real authentication (PHASE 03 — email/password, DB-backed sessions) ─
  // Every /v1/admin/* request resolves a session cookie to a real Actor with
  // real permissions (docs/07 §5, §6). requirePermission then enforces the
  // permission each route declared in the registry — the ONLY enforcement
  // layer that is security (docs/08 §5.1). csrfProtection guards every
  // mutating admin request as defence in depth alongside SameSite=Strict
  // (docs/23 §6).
  //
  // This REPLACES the Firebase session-cookie design (and, before that, the
  // PHASE 02 devAdminAuth bypass) entirely — neither is wired into the app
  // anymore (ADR-030, ADR-037 superseded).
  app.use('/v1/admin/*', adminAuth);
  app.use('/v1/admin/*', csrfProtection);
  app.use('/v1/admin/*', requirePermission);

  // Every /v1/me/* request resolves a bearer session token to a real
  // CUSTOMER actor (docs/07 §4, §6). No /v1/me/* routes exist yet (they
  // arrive with the catalogue/cart/order phases) — wired proactively so a
  // future route only has to be added to this router, never to auth.
  app.use('/v1/me/*', customerAuth);

  // ── Routes ──────────────────────────────────────────────────────────────
  app.route('/v1', healthRoutes());
  app.route('/v1/public', publicServiceabilityRoutes());
  app.route('/v1/public', publicCatalogueRoutes());
  app.route('/v1/auth', customerAuthRoutes());
  app.route('/v1/auth', passwordSetupRoutes());
  app.route('/v1/me/addresses', addressesRoutes());
  app.route('/v1/me/cart', cartRoutes());
  app.route('/v1/me/orders', ordersRoutes());
  app.route('/v1/me/delivery-slots', deliverySlotsRoutes());
  app.route('/v1/admin/auth', adminAuthRoutes());
  app.route('/v1/admin', adminServiceabilityRoutes());
  app.route('/v1/admin/admin-users', adminUsersRoutes());
  app.route('/v1/admin', rolesRoutes());
  app.route('/v1/admin', adminOrdersRoutes());
  app.route('/v1/admin', adminCatalogueRoutes());
  app.route('/v1/admin', adminDeliverySlotsRoutes());

  /**
   * OpenAPI 3.1, generated from the same Zod schemas the API validates with.
   * There is no second hand-written document to drift (docs/03 §2).
   */
  app.get('/v1/openapi.json', (c) =>
    c.json(
      buildOpenApiDocument(toOpenApiSpecs(), {
        version: env.APP_VERSION,
        serverUrl: env.API_BASE_URL,
        environment: env.APP_ENV,
      }),
    ),
  );

  /**
   * Route manifest.
   *
   * Published deliberately: it documents the audience and required permission
   * of every endpoint, which is the contract the authorization matrix test is
   * generated from (docs/24 §3). Nothing sensitive is exposed — it is the
   * same information as the OpenAPI document.
   */
  app.get('/v1/routes', (c) =>
    c.json({
      data: listRoutes().map((r) => ({
        method: r.method,
        path: r.path,
        audience: r.audience,
        permission: r.permission ?? null,
        auth_route: r.authRoute ?? false,
        phase: r.phase,
        summary: r.summary,
      })),
    }),
  );

  return app;
}
