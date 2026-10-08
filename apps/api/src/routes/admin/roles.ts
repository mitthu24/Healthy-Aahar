import {
  createRoleBodySchema,
  errorResponseSchema,
  idParamSchema,
  permissionListResponseSchema,
  roleListResponseSchema,
  roleSchema,
  updateRolePermissionsBodySchema,
} from '@healthy-aahar/contracts';
import { businessScope, DomainError, PERMISSIONS, type RoleRow } from '@healthy-aahar/core';
import { Hono } from 'hono';

import { registerRoute } from '../../lib/route-registry.js';
import type { AppBindings } from '../../types.js';

const jsonError = (description: string) => ({ description, schema: errorResponseSchema });

/**
 * Roles are DATA, permissions are CODE (docs/08 §1). `roles:manage` is
 * itself Super-Admin-only — enforced both at the route (permission) and
 * again in `RbacService` (defence in depth, since granting `roles:manage`
 * IS the privilege-escalation boundary).
 */

registerRoute({
  method: 'GET',
  path: '/v1/admin/roles',
  audience: 'admin',
  permission: 'roles:read',
  summary: 'List roles and their permissions',
  phase: '03',
  openapi: {
    tags: ['Admin: Roles'],
    responses: { 200: { description: 'Roles', schema: roleListResponseSchema } },
  },
});

registerRoute({
  method: 'POST',
  path: '/v1/admin/roles',
  audience: 'admin',
  permission: 'roles:manage',
  summary: 'Create a role',
  phase: '03',
  errors: ['UNKNOWN_PERMISSION', 'FORBIDDEN'],
  openapi: {
    tags: ['Admin: Roles'],
    request: { body: createRoleBodySchema },
    responses: {
      201: { description: 'Role created', schema: roleSchema },
      422: jsonError('Unknown permission key'),
    },
  },
});

registerRoute({
  method: 'PUT',
  path: '/v1/admin/roles/{id}/permissions',
  audience: 'admin',
  permission: 'roles:manage',
  summary: 'Replace a role\'s permission set',
  phase: '03',
  errors: ['UNKNOWN_PERMISSION', 'FORBIDDEN', 'NOT_FOUND'],
  openapi: {
    tags: ['Admin: Roles'],
    request: { params: idParamSchema, body: updateRolePermissionsBodySchema },
    responses: {
      200: { description: 'Updated', schema: roleSchema },
      404: jsonError('Not found'),
      422: jsonError('Unknown permission key'),
    },
  },
});

registerRoute({
  method: 'GET',
  path: '/v1/admin/permissions',
  audience: 'admin',
  permission: 'roles:read',
  summary: 'The full permission catalogue (code, not data — docs/08 §1)',
  phase: '03',
  openapi: {
    tags: ['Admin: Roles'],
    responses: { 200: { description: 'Permissions', schema: permissionListResponseSchema } },
  },
});

function toResponse(role: RoleRow) {
  return {
    id: role.id,
    key: role.key,
    name: role.name,
    description: role.description,
    is_system: role.isSystem,
    permissions: role.permissionKeys,
  };
}

export function rolesRoutes(): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.get('/roles', async (c) => {
    const scope = businessScope(c.env.businessId);
    const rows = await c.env.services.rbac.roles.list(scope);
    return c.json({ data: rows.map(toResponse) });
  });

  app.post('/roles', async (c) => {
    const body = createRoleBodySchema.parse(await c.req.json());
    const actor = c.get('actor');
    if (actor.kind !== 'ADMIN') throw new DomainError('UNAUTHENTICATED', 'Not authenticated.');

    const scope = businessScope(c.env.businessId);
    const created = await c.env.services.rbac.createRole(
      scope,
      { key: body.key, name: body.name, description: body.description, permissionKeys: body.permission_keys },
      actor.userId,
    );
    return c.json(toResponse(created), 201);
  });

  app.put('/roles/:id/permissions', async (c) => {
    const params = idParamSchema.parse({ id: c.req.param('id') });
    const body = updateRolePermissionsBodySchema.parse(await c.req.json());
    const actor = c.get('actor');
    if (actor.kind !== 'ADMIN') throw new DomainError('UNAUTHENTICATED', 'Not authenticated.');

    const scope = businessScope(c.env.businessId);
    const existing = await c.env.services.rbac.roles.findById(scope, params.id);
    if (!existing) throw new DomainError('NOT_FOUND', 'Role not found.');

    const updated = await c.env.services.rbac.updateRolePermissions(scope, {
      roleId: params.id,
      permissionKeys: body.permission_keys,
      actorUserId: actor.userId,
      actorIsSuperAdmin: actor.isSuperAdmin,
    });
    return c.json(toResponse(updated));
  });

  app.get('/permissions', async (c) => {
    return c.json({
      data: PERMISSIONS.map((p) => ({ key: p.key, resource: p.resource, action: p.action, description: p.description })),
    });
  });

  return app;
}
