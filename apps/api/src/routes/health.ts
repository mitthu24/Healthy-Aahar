import { healthResponseSchema, readinessResponseSchema } from '@healthy-aahar/contracts';
import { now } from '@healthy-aahar/core';
import { checkDatabaseHealth } from '@healthy-aahar/db';
import { Hono } from 'hono';

import { registerRoute } from '../lib/route-registry.js';
import type { AppBindings } from '../types.js';

/**
 * Health endpoints (docs/06-API-SPECIFICATION.md §2).
 *
 * `/v1/health` is liveness: is this process alive. It touches nothing, so a
 * database outage never makes the container look dead and trigger a restart
 * loop that cannot possibly help.
 *
 * `/v1/health/ready` is readiness: should traffic be sent here. Railway gates
 * a deploy on this, so a new version with a broken database never receives
 * traffic instead of failing every request (docs/25 §6).
 */

registerRoute({
  method: 'GET',
  path: '/v1/health',
  audience: 'public',
  summary: 'Liveness probe',
  phase: '01',
  openapi: {
    description: 'Touches nothing, so a database outage never makes the container look dead.',
    tags: ['Health'],
    responses: { 200: { description: 'Process is alive', schema: healthResponseSchema } },
  },
});

registerRoute({
  method: 'GET',
  path: '/v1/health/ready',
  audience: 'public',
  summary: 'Readiness probe including database connectivity',
  phase: '01',
  openapi: {
    description:
      'Also confirms migrations are applied. A database that accepts ' +
      'connections but has no schema is the exact failure mode of a ' +
      'half-finished deploy, and a naive ping would report it healthy.',
    tags: ['Health'],
    responses: {
      200: { description: 'Ready (or degraded)', schema: readinessResponseSchema },
      503: { description: 'Database unreachable', schema: readinessResponseSchema },
    },
  },
});

const bootedAt = Date.now();

export function healthRoutes(): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.get('/health', (c) => {
    const env = c.env.env;

    return c.json(
      {
        status: 'ok' as const,
        version: env.APP_VERSION,
        env: env.APP_ENV,
        uptime_s: Math.floor((Date.now() - bootedAt) / 1000),
        timestamp: now().toISOString(),
      },
      200,
      { 'Cache-Control': 'no-store' },
    );
  });

  app.get('/health/ready', async (c) => {
    const env = c.env.env;
    const database = await checkDatabaseHealth(c.env.prisma);

    // 'degraded' still returns 200: the service can serve reads and a
    // slow database is not a reason to pull the instance out of rotation.
    // Only 'down' returns 503.
    const httpStatus = database.status === 'down' ? 503 : 200;

    if (database.status !== 'ok') {
      c.get('logger')?.warn(
        { msg: 'health.database_not_ok', status: database.status, reason: database.reason },
        'database health degraded',
      );
    }

    return c.json(
      {
        status: database.status,
        version: env.APP_VERSION,
        env: env.APP_ENV,
        timestamp: now().toISOString(),
        checks: {
          database: {
            status: database.status,
            latency_ms: database.latencyMs,
            ...('migrationsApplied' in database
              ? { migrations_applied: database.migrationsApplied }
              : {}),
            ...('reason' in database ? { reason: database.reason } : {}),
          },
        },
      },
      httpStatus,
      { 'Cache-Control': 'no-store' },
    );
  });

  return app;
}
