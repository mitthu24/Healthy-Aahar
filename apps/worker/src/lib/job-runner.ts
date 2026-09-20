import { newId, now } from '@healthy-aahar/core';
import type { PrismaClient } from '@healthy-aahar/db';
import type { Logger } from '@healthy-aahar/observability';

/**
 * Job runner.
 *
 * Two responsibilities, both of which exist because of specific failure modes
 * documented in PHASE 00:
 *
 * 1. **Advisory locking.** A redeploy overlap or a second replica must never
 *    run the same job twice. A PostgreSQL advisory lock is used rather than a
 *    queue broker, because at this volume a broker is infrastructure without
 *    additional guarantee (ADR-004).
 *
 * 2. **Run recording.** Every execution writes a `job_runs` row. A failing job
 *    is loud; a job that silently stopped running is not — and the latter is
 *    how a subscription business quietly stops delivering. The dead-man's
 *    switch in docs/28 §8 reads these rows.
 */

export type JobContext = {
  prisma: PrismaClient;
  logger: Logger;
  businessId: string;
};

export type JobResult = {
  itemsProcessed: number;
  metadata?: Record<string, unknown>;
};

export type JobDefinition = {
  name: string;
  /** Cron expression in the business timezone. */
  schedule: string;
  /** Phase that introduces the real implementation. */
  phase: string;
  description: string;
  run: (context: JobContext) => Promise<JobResult>;
};

/** Stable 64-bit-ish lock key derived from the job name. */
function lockKeyFor(jobName: string): bigint {
  let hash = 0n;
  for (const char of jobName) {
    hash = (hash * 31n + BigInt(char.codePointAt(0) ?? 0)) % 9_223_372_036_854_775_807n;
  }
  return hash;
}

export async function runJob(job: JobDefinition, context: JobContext): Promise<void> {
  const { prisma, logger } = context;
  const jobLogger = logger.child({ job: job.name });
  const lockKey = lockKeyFor(job.name);

  // pg_try_advisory_lock returns immediately rather than waiting. If another
  // instance holds it, skipping is correct: the job will run on its next tick.
  const [lock] = await prisma.$queryRaw<Array<{ acquired: boolean }>>`
    SELECT pg_try_advisory_lock(${lockKey}::bigint) AS acquired
  `;

  if (!lock?.acquired) {
    jobLogger.info({ msg: 'job.skipped_locked' }, 'another instance holds the lock');
    return;
  }

  const runId = newId();
  const startedAt = now();

  await prisma.jobRun.create({
    data: { id: runId, jobName: job.name, startedAt, status: 'RUNNING' },
  });

  jobLogger.info({ msg: 'job.started', run_id: runId }, 'job started');

  try {
    const result = await job.run(context);

    await prisma.jobRun.update({
      where: { id: runId },
      data: {
        finishedAt: now(),
        status: 'SUCCEEDED',
        itemsProcessed: result.itemsProcessed,
        metadata: (result.metadata ?? {}) as never,
      },
    });

    jobLogger.info(
      {
        msg: 'job.completed',
        run_id: runId,
        items_processed: result.itemsProcessed,
        duration_ms: Date.now() - startedAt.getTime(),
      },
      'job completed',
    );
  } catch (error) {
    await prisma.jobRun.update({
      where: { id: runId },
      data: {
        finishedAt: now(),
        status: 'FAILED',
        error: error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown error',
      },
    });

    // Logged and recorded, never rethrown: one failing job must not take the
    // worker process down and stop every other job with it.
    jobLogger.error(
      {
        msg: 'job.failed',
        run_id: runId,
        err: error instanceof Error ? { name: error.name, message: error.message } : error,
      },
      'job failed',
    );
  } finally {
    await prisma.$queryRaw`SELECT pg_advisory_unlock(${lockKey}::bigint)`;
  }
}
