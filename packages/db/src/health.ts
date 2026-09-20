import type { PrismaClient } from '@prisma/client';

export type DatabaseHealth =
  | { status: 'ok'; latencyMs: number; migrationsApplied: number }
  | { status: 'degraded'; latencyMs: number; migrationsApplied: number; reason: string }
  | { status: 'down'; latencyMs: number; reason: string };

const DEGRADED_LATENCY_MS = 500;

/**
 * Readiness check for `GET /v1/health/ready`.
 *
 * Deliberately does more than `SELECT 1`: it also confirms that migrations
 * have actually been applied. A database that accepts connections but has no
 * schema is the exact failure mode of a half-finished deploy, and a naive
 * ping would report it as healthy while every real request 500s.
 */
export async function checkDatabaseHealth(prisma: PrismaClient): Promise<DatabaseHealth> {
  const startedAt = performance.now();

  try {
    const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS count
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = '_prisma_migrations'
    `;

    const hasMigrationTable = (rows[0]?.count ?? 0n) > 0n;
    const latencyMs = Math.round(performance.now() - startedAt);

    if (!hasMigrationTable) {
      return {
        status: 'degraded',
        latencyMs,
        migrationsApplied: 0,
        reason: 'Migration table missing — run `pnpm db:migrate`',
      };
    }

    const applied = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS count
      FROM "_prisma_migrations"
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
    `;

    const migrationsApplied = Number(applied[0]?.count ?? 0n);
    const totalMs = Math.round(performance.now() - startedAt);

    if (migrationsApplied === 0) {
      return {
        status: 'degraded',
        latencyMs: totalMs,
        migrationsApplied,
        reason: 'No migrations applied — run `pnpm db:migrate`',
      };
    }

    if (totalMs > DEGRADED_LATENCY_MS) {
      return {
        status: 'degraded',
        latencyMs: totalMs,
        migrationsApplied,
        reason: `Database latency ${totalMs}ms exceeds ${DEGRADED_LATENCY_MS}ms`,
      };
    }

    return { status: 'ok', latencyMs: totalMs, migrationsApplied };
  } catch (error) {
    return {
      status: 'down',
      latencyMs: Math.round(performance.now() - startedAt),
      // The message is for operators in a log, never returned to a caller —
      // a connection string can appear in a Prisma error (docs/23 §11).
      reason: error instanceof Error ? error.name : 'Unknown database error',
    };
  }
}
