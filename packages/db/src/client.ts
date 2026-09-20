import { PrismaClient } from '@prisma/client';

/**
 * PostgreSQL access. This module is the ONLY place in the system that opens a
 * database connection, and only apps/api and apps/worker may import it —
 * enforced by a lint rule in packages/config/eslint/next.js
 * (docs/02-SYSTEM-ARCHITECTURE.md principle 2).
 */

export type DatabaseClientOptions = {
  databaseUrl: string;
  /** Statement timeout in milliseconds. Prevents one pathological query from
   *  holding a connection open and starving the pool. */
  statementTimeoutMs?: number;
  logQueries?: boolean;
};

let singleton: PrismaClient | null = null;

function buildConnectionUrl(options: DatabaseClientOptions): string {
  const url = new URL(options.databaseUrl);

  // Applied at the connection level so it cannot be forgotten per query.
  if (options.statementTimeoutMs && !url.searchParams.has('statement_timeout')) {
    url.searchParams.set('statement_timeout', String(options.statementTimeoutMs));
  }

  return url.toString();
}

export function createDatabaseClient(options: DatabaseClientOptions): PrismaClient {
  return new PrismaClient({
    datasources: { db: { url: buildConnectionUrl(options) } },
    log: options.logQueries
      ? [
          { emit: 'stdout', level: 'query' },
          { emit: 'stdout', level: 'warn' },
          { emit: 'stdout', level: 'error' },
        ]
      : [
          { emit: 'stdout', level: 'warn' },
          { emit: 'stdout', level: 'error' },
        ],
  });
}

/**
 * Process-wide client.
 *
 * The API and worker are long-lived processes, so a single pooled client is
 * correct and is one of the reasons the API is not serverless (ADR-002).
 */
export function getDatabaseClient(options: DatabaseClientOptions): PrismaClient {
  if (!singleton) {
    singleton = createDatabaseClient(options);
  }
  return singleton;
}

export async function disconnectDatabase(): Promise<void> {
  if (singleton) {
    await singleton.$disconnect();
    singleton = null;
  }
}

export type { PrismaClient };
export { Prisma } from '@prisma/client';
