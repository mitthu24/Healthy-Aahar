import type { ServerEnv } from '@healthy-aahar/config/env/server';
import type {
  AdminAuthService,
  CustomerAuthService,
  PasswordResetService,
  RbacService,
  ServiceabilityAdminService,
  ServiceabilityService,
} from '@healthy-aahar/core';
import type { PermissionCache } from '@healthy-aahar/auth';
import type { RateLimitStore } from './middleware/rate-limit.js';
import type { PrismaClient } from '@healthy-aahar/db';
import type { Logger } from '@healthy-aahar/observability';

/**
 * Request-scoped context.
 *
 * `actor` is populated by the auth middleware (docs/07 §6). Handlers receive
 * it; they never read headers or tokens themselves.
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
  customerAuth: CustomerAuthService;
  adminAuth: AdminAuthService;
  rbac: RbacService;
  passwordReset: PasswordResetService;
};

export type AppAuth = {
  permissionCache: PermissionCache;
  /** Shared in-process store backing both the per-route and login rate limiters. */
  loginRateLimitStore: RateLimitStore;
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
    auth: AppAuth;
    /**
     * The active business. Resolved once at boot from the single seeded row.
     * Carried in context rather than looked up per request so that every query
     * is scoped by it from day one, which is what makes multi-business a data
     * change rather than a rewrite (ADR-005).
     */
    businessId: string;
  };
};
