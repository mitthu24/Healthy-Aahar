import { createMiddleware } from 'hono/factory';

import { DomainError } from '@healthy-aahar/core';

import { listRoutes } from '../lib/route-registry.js';
import type { AppBindings } from '../types.js';

/**
 * Enforces the permission declared on the matched route (docs/08 §5.1,
 * layer 1 — "the only layer that is security"). Built once from the route
 * registry, so a route's declared permission and its enforcement can never
 * drift: there is one list, read by both the boot-time soundness check and
 * this middleware.
 *
 * `authRoute: true` routes (login/logout/me) are exempt — see
 * `route-registry.ts` for why a permission requirement makes no sense on an
 * endpoint whose entire job is to establish who the caller is.
 *
 * IMPORTANT: this middleware is mounted with `app.use('/v1/admin/*', ...)`
 * — a wildcard. Inside a wildcard-mounted middleware, Hono's
 * `c.req.routePath` reports the MIDDLEWARE's own registration pattern
 * (`/v1/admin/*`), not the specific route that will eventually match
 * (verified empirically: only the terminal route handler sees the real
 * matched pattern). Matching therefore has to be done by hand against
 * `c.req.path`, not by trusting `routePath` — a regex built from each
 * registered route's declared path, checked in registration order.
 */

type CompiledRoute = { method: string; regex: RegExp; permission: string };

/** Registry paths are OpenAPI-style (`/v1/admin/cities/{id}`) → an exact-segment regex. */
function toPathRegex(openApiPath: string): RegExp {
  const pattern = openApiPath
    .split('/')
    .map((segment) => (segment.startsWith('{') && segment.endsWith('}') ? '[^/]+' : segment))
    .join('/');
  return new RegExp(`^${pattern}$`);
}

function buildCompiledRoutes(): CompiledRoute[] {
  return listRoutes()
    .filter((route) => route.audience === 'admin' && route.permission && !route.authRoute)
    .map((route) => ({
      method: route.method,
      regex: toPathRegex(route.path),
      permission: route.permission!,
    }));
}

let compiled: CompiledRoute[] | null = null;

/** Test helper — the registry can gain routes between test files. */
export function resetPermissionIndex(): void {
  compiled = null;
}

function findRequiredPermission(method: string, path: string): string | undefined {
  if (!compiled) compiled = buildCompiledRoutes();
  return compiled.find((r) => r.method === method && r.regex.test(path))?.permission;
}

export const requirePermission = createMiddleware<AppBindings>(async (c, next) => {
  const required = findRequiredPermission(c.req.method, c.req.path);

  // A matched route with no declared permission is either an authRoute
  // (exempt by design) or a registry bug the boot-time assertion would have
  // already caught — either way, nothing to enforce here.
  if (!required) {
    await next();
    return;
  }

  const actor = c.get('actor');

  if (actor.kind !== 'ADMIN') {
    throw new DomainError('UNAUTHENTICATED', 'Admin authentication required.');
  }

  const allowed = actor.isSuperAdmin || actor.permissions.has(required);

  if (!allowed) {
    c.get('logger')?.warn(
      { msg: 'authz.denied', permission: required, admin_user_id: actor.adminUserId },
      'admin request denied',
    );
    throw new DomainError('FORBIDDEN', `Missing required permission: ${required}`);
  }

  await next();
});
