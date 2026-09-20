import type { ServerEnv } from '@healthy-aahar/config/env/server';
import { ServiceabilityService } from '@healthy-aahar/core';
import type { PrismaClient } from '@healthy-aahar/db';
import type { Logger } from '@healthy-aahar/observability';
import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { assertRegistryIsSound, listRoutes } from './lib/route-registry.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { InMemoryRateLimitStore, rateLimit } from './middleware/rate-limit.js';
import { requestId } from './middleware/request-id.js';
import { securityHeaders } from './middleware/security-headers.js';
import { PrismaServiceabilityRepository } from './repositories/prisma-serviceability-repository.js';
import { healthRoutes } from './routes/health.js';
import { publicServiceabilityRoutes } from './routes/public/serviceability.js';
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
 * client could call every endpoint (docs/30 §10).
 */
export function createApp(options: CreateAppOptions): Hono<AppBindings> {
  const { env, prisma, logger, businessId } = options;

  // Fail the boot, not a request, if any route is under-declared (BR-SEC12).
  assertRegistryIsSound();

  const services = {
    serviceability: new ServiceabilityService({
      repository: new PrismaServiceabilityRepository(prisma),
      brandName: 'Healthy Aahar',
    }),
  };

  const app = new Hono<AppBindings>();

  // Dependencies are attached per request rather than imported as module
  // singletons, which is what lets tests run against an isolated database.
  app.use('*', async (c, next) => {
    c.env = { ...c.env, env, prisma, services, businessId };
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
      ],
      exposeHeaders: ['X-Request-Id', 'X-RateLimit-Remaining', 'X-RateLimit-Reset', 'Retry-After'],
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

  // ── Routes ──────────────────────────────────────────────────────────────
  app.route('/v1', healthRoutes());
  app.route('/v1/public', publicServiceabilityRoutes());

  /**
   * Route manifest.
   *
   * Published deliberately: it documents the audience and required permission
   * of every endpoint, which is the contract PHASE 03's authorization matrix
   * test is generated from (docs/24 §3). Nothing sensitive is exposed — it is
   * the same information as the OpenAPI document.
   */
  app.get('/v1/routes', (c) =>
    c.json({
      data: listRoutes().map((r) => ({
        method: r.method,
        path: r.path,
        audience: r.audience,
        permission: r.permission ?? null,
        phase: r.phase,
        summary: r.summary,
      })),
    }),
  );

  return app;
}
