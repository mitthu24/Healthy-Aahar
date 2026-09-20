import { loadServerEnv } from '@healthy-aahar/config/env/server';
import { disconnectDatabase, getDatabaseClient } from '@healthy-aahar/db';
import { createLogger } from '@healthy-aahar/observability';
import cron from 'node-cron';

import { jobs } from './jobs/index.js';
import { runJob } from './lib/job-runner.js';

/**
 * Worker entrypoint.
 *
 * Runs as a separate Railway service so a long nightly batch never competes
 * with checkout latency, and so it can be restarted independently (ADR-004).
 */
async function main(): Promise<void> {
  const env = loadServerEnv();

  const logger = createLogger({
    service: 'worker',
    env: env.APP_ENV,
    version: env.APP_VERSION,
    level: env.LOG_LEVEL,
    pretty: env.APP_ENV === 'local',
  });

  if (!env.WORKER_ENABLED) {
    logger.warn({ msg: 'worker.disabled' }, 'WORKER_ENABLED=false, exiting');
    return;
  }

  const prisma = getDatabaseClient({
    databaseUrl: env.DATABASE_URL,
    statementTimeoutMs: env.DATABASE_STATEMENT_TIMEOUT_MS,
  });

  const business = await prisma.business.findFirst({
    where: { status: 'ACTIVE' },
    orderBy: { createdAt: 'asc' },
    select: { id: true, slug: true, timezone: true },
  });

  if (!business) {
    throw new Error('No ACTIVE business row found. Run `pnpm db:migrate && pnpm db:seed` first.');
  }

  const context = { prisma, logger, businessId: business.id };
  const tasks: cron.ScheduledTask[] = [];

  for (const job of jobs) {
    if (!cron.validate(job.schedule)) {
      throw new Error(`Job "${job.name}" has an invalid cron expression: ${job.schedule}`);
    }

    // Schedules are interpreted in the BUSINESS timezone, not the server's.
    // A nightly 01:00 job must mean 01:00 IST regardless of where the
    // container runs (ADR-007).
    const task = cron.schedule(job.schedule, () => void runJob(job, context), {
      timezone: business.timezone,
    });

    tasks.push(task);
    logger.info(
      { msg: 'worker.job_scheduled', job: job.name, schedule: job.schedule, phase: job.phase },
      `scheduled ${job.name}`,
    );
  }

  logger.info(
    { msg: 'worker.started', jobs: jobs.length, timezone: business.timezone },
    `worker started with ${jobs.length} jobs`,
  );

  const shutdown = (signal: string) => {
    logger.info({ msg: 'worker.shutdown', signal }, 'shutting down');
    for (const task of tasks) task.stop();
    void disconnectDatabase().then(() => process.exit(0));
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error: unknown) => {
  console.error('[worker] failed to start:', error instanceof Error ? error.message : error);
  process.exit(1);
});
