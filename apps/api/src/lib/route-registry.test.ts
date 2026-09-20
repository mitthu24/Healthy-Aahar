import { describe, expect, it } from 'vitest';

import {
  assertRegistryIsSound,
  RouteRegistryError,
  type RouteDescriptor,
} from './route-registry.js';

const ok: RouteDescriptor = {
  method: 'GET',
  path: '/v1/public/serviceability',
  audience: 'public',
  summary: 'Check serviceability',
  phase: '01',
};

describe('assertRegistryIsSound', () => {
  it('accepts a well-formed registry', () => {
    expect(() =>
      assertRegistryIsSound([
        ok,
        {
          method: 'POST',
          path: '/v1/admin/cities',
          audience: 'admin',
          permission: 'delivery:manage',
          summary: 'Create a city',
          phase: '04',
        },
      ]),
    ).not.toThrow();
  });

  it('rejects an admin route with no permission', () => {
    // This is the check that makes an unguarded admin endpoint impossible to
    // ship: the service refuses to boot rather than serving it (BR-SEC12).
    expect(() =>
      assertRegistryIsSound([
        {
          method: 'POST',
          path: '/v1/admin/cities',
          audience: 'admin',
          summary: 'Create a city',
          phase: '04',
        },
      ]),
    ).toThrow(RouteRegistryError);
  });

  it('rejects a permission on a non-admin route', () => {
    // A permission on a public route means someone misunderstood the model
    // and probably believes the route is protected when it is not.
    expect(() => assertRegistryIsSound([{ ...ok, permission: 'delivery:manage' }])).toThrow(
      /audience is "public"/,
    );
  });

  it('rejects a malformed permission key', () => {
    expect(() =>
      assertRegistryIsSound([
        {
          method: 'GET',
          path: '/v1/admin/cities',
          audience: 'admin',
          permission: 'ManageCities',
          summary: 'List cities',
          phase: '04',
        },
      ]),
    ).toThrow(/resource:action/);
  });

  it('rejects a route whose path does not match its audience', () => {
    // Prevents an admin route from being registered under /v1/public, where
    // the audience middleware would never guard it.
    expect(() =>
      assertRegistryIsSound([
        {
          method: 'GET',
          path: '/v1/public/cities',
          audience: 'admin',
          permission: 'delivery:read',
          summary: 'Mislabelled route',
          phase: '04',
        },
      ]),
    ).toThrow(/does not start with/);
  });

  it('rejects an unversioned path', () => {
    expect(() => assertRegistryIsSound([{ ...ok, path: '/public/serviceability' }])).toThrow(
      /version prefix/,
    );
  });

  it('rejects a duplicate registration', () => {
    expect(() => assertRegistryIsSound([ok, ok])).toThrow(/more than once/);
  });

  it('allows meta routes outside the audience prefixes', () => {
    expect(() =>
      assertRegistryIsSound([
        { method: 'GET', path: '/v1/health', audience: 'public', summary: 'Liveness', phase: '01' },
        {
          method: 'GET',
          path: '/v1/health/ready',
          audience: 'public',
          summary: 'Readiness',
          phase: '01',
        },
      ]),
    ).not.toThrow();
  });

  it('reports every problem at once rather than the first', () => {
    // A boot failure should tell an engineer everything that is wrong, not
    // make them fix one issue per deploy attempt.
    try {
      assertRegistryIsSound([
        { method: 'POST', path: '/v1/admin/a', audience: 'admin', summary: 'a', phase: '04' },
        { method: 'POST', path: '/v1/admin/b', audience: 'admin', summary: 'b', phase: '04' },
      ]);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as Error).message).toContain('/v1/admin/a');
      expect((error as Error).message).toContain('/v1/admin/b');
    }
  });
});
