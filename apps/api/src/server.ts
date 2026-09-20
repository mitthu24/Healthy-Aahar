import { serve } from '@hono/node-server';
import { loadServerEnv } from '@healthy-aahar/config/env/server';
import { getDatabaseClient, disconnectDatabase } from '@healthy-aahar/db';
import { createLogger } from '@healthy-aahar/observability';

import { createApp } from './app.js';

/**
 * API entrypoint.
 *
 * Boot order is deliberate: validate configuration, connect to the database,
 * resolve the active business, then start listening. A service that accepts
 * traffic before it can serve it is worse than one that fails to start.
 */
async function main(): Promise<void> {
  // Throws with a readable, aggregated message if anything is missing (BR-ENV1).
  const env = loadServerEnv();

  const logger = createLogger({
    service: 'api',
    env: env.APP_ENV,
    version: env.APP_VERSION,
    level: env.LOG_LEVEL,
    pretty: env.APP_ENV === 'local',
  });

  const prisma = getDatabaseClient({
    databaseUrl: env.DATABASE_URL,
    statementTimeoutMs: env.DATABASE_STATEMENT_TIMEOUT_MS,
    logQueries: env.LOG_LEVEL === 'debug',
  });

  // Resolve the single active business once, rather than per request.
  const business = await prisma.business.findFirst({
    where: { status: 'ACTIVE' },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, slug: true },
  });

  if (!business) {
    throw new Error(
      'No ACTIVE business row found. Run `pnpm db:migrate && pnpm db:seed` before starting the API.',
    );
  }

  const app = createApp({ env, prisma, logger, businessId: business.id });

  const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
    logger.info(
      {
        msg: 'api.started',
        port: info.port,
        env: env.APP_ENV,
        version: env.APP_VERSION,
        business: business.slug,
      },
      `API listening on :${info.port}`,
    );
  });

  // Graceful shutdown: stop accepting connections, let in-flight requests
  // finish, then close the pool. Without this, a deploy can abort a
  // transaction mid-write (docs/29 §6, EC-X4).
  const shutdown = (signal: string) => {
    logger.info({ msg: 'api.shutdown', signal }, 'shutting down');

    server.close(() => {
      void disconnectDatabase().then(() => {
        logger.info({ msg: 'api.stopped' }, 'stopped');
        process.exit(0);
      });
    });

    // Never hang forever waiting for a stuck connection.
    setTimeout(() => {
      logger.error({ msg: 'api.forced_shutdown' }, 'forced shutdown after timeout');
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error: unknown) => {
  // The logger may not exist yet if configuration failed, so this is the one
  // place a bare console write is correct.
  console.error('[api] failed to start:', error instanceof Error ? error.message : error);
  process.exit(1);
});
