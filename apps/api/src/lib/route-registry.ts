import type { ErrorCode } from '@healthy-aahar/contracts';

/**
 * Route registry.
 *
 * Every route declares the audience it serves and, for admin routes, the
 * permission it requires. `assertRegistryIsSound()` runs at boot and throws if
 * any route is under-declared, so an unguarded admin endpoint crashes the
 * service on deploy rather than shipping a hole into production
 * (docs/23-SECURITY-ARCHITECTURE.md §4, BR-SEC12).
 *
 * This is the mechanism that makes "we always remember to add the permission
 * check" unnecessary — forgetting becomes impossible rather than discouraged.
 */

export type Audience = 'public' | 'customer' | 'admin' | 'internal' | 'webhook';

export type RouteDescriptor = {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  audience: Audience;
  /** Required for `admin`; forbidden for every other audience. */
  permission?: string;
  summary: string;
  /** Phase that introduces the real implementation; informational. */
  phase: string;
  /** Error codes this route may return, surfaced in OpenAPI. */
  errors?: ErrorCode[];
  /** True when the route requires an Idempotency-Key header. */
  idempotent?: boolean;
};

const registry: RouteDescriptor[] = [];

export function registerRoute(descriptor: RouteDescriptor): RouteDescriptor {
  registry.push(descriptor);
  return descriptor;
}

export function listRoutes(): readonly RouteDescriptor[] {
  return registry;
}

export class RouteRegistryError extends Error {
  constructor(problems: string[]) {
    super(
      [
        'Route registry is unsound. The service will not start.',
        ...problems.map((p) => `  - ${p}`),
        '',
        'See docs/23-SECURITY-ARCHITECTURE.md §4.',
      ].join('\n'),
    );
    this.name = 'RouteRegistryError';
  }
}

export function assertRegistryIsSound(routes: readonly RouteDescriptor[] = registry): void {
  const problems: string[] = [];
  const seen = new Set<string>();

  for (const route of routes) {
    const id = `${route.method} ${route.path}`;

    if (seen.has(id)) {
      problems.push(`${id} is registered more than once`);
    }
    seen.add(id);

    if (route.audience === 'admin' && !route.permission) {
      problems.push(`${id} is an admin route but declares no permission`);
    }

    if (route.audience !== 'admin' && route.permission) {
      problems.push(
        `${id} declares permission "${route.permission}" but its audience is "${route.audience}". ` +
          'Permissions only apply to admin routes.',
      );
    }

    if (
      route.audience === 'admin' &&
      route.permission &&
      !/^[a-z_]+:[a-z_]+$/.test(route.permission)
    ) {
      problems.push(
        `${id} declares permission "${route.permission}", which is not in resource:action form`,
      );
    }

    if (!route.path.startsWith('/v1/')) {
      problems.push(`${id} is not under a version prefix (expected /v1/...)`);
    }

    // The audience must match the path prefix, so a route cannot claim to be
    // public while living under /v1/admin, or vice versa.
    const expectedPrefix: Record<Audience, string> = {
      public: '/v1/public/',
      customer: '/v1/me/',
      admin: '/v1/admin/',
      internal: '/v1/internal/',
      webhook: '/v1/webhooks/',
    };

    const isMetaRoute = route.path.startsWith('/v1/health') || route.path === '/v1/openapi.json';

    if (!isMetaRoute && !route.path.startsWith(expectedPrefix[route.audience])) {
      problems.push(
        `${id} has audience "${route.audience}" but path does not start with "${expectedPrefix[route.audience]}"`,
      );
    }
  }

  if (problems.length > 0) {
    throw new RouteRegistryError(problems);
  }
}

/** Test helper. Never call from application code. */
export function resetRegistry(): void {
  registry.length = 0;
}
