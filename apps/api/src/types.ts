import type { ServerEnv } from '@healthy-aahar/config/env/server';
import type { ServiceabilityAdminService, ServiceabilityService } from '@healthy-aahar/core';
import type { PrismaClient } from '@healthy-aahar/db';
import type { Logger } from '@healthy-aahar/observability';

/**
 * Request-scoped context.
 *
 * `actor` is populated by the auth middleware in PHASE 03. It is declared now
 * so route handlers are written against it from the start and never reach for
 * headers or tokens themselves (docs/07 §6).
 */
export type Actor =
  | { kind: 'ANONYMOUS' }
  | { kind: 'CUSTOMER'; userId: string; customerProfileId: string }
  | {
      kind: 'ADMIN';
      userId: string;
      adminUserId: string;
      permissions: ReadonlySet<string>;
      isSuperAdmin: boolean;
    }
  | { kind: 'SYSTEM'; jobName: string };

export type AppServices = {
  serviceability: ServiceabilityService;
  serviceabilityAdmin: ServiceabilityAdminService;
};

export type AppBindings = {
  Variables: {
    requestId: string;
    logger: Logger;
    actor: Actor;
    startedAt: number;
  };
  Bindings: {
    env: ServerEnv;
    prisma: PrismaClient;
    services: AppServices;
    /**
     * The active business. Resolved once at boot from the single seeded row.
     * Carried in context rather than looked up per request so that every query
     * is scoped by it from day one, which is what makes multi-business a data
     * change rather than a rewrite (ADR-005).
     */
    businessId: string;
  };
};
