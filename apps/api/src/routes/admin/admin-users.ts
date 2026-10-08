import {
  adminUserListResponseSchema,
  adminUserSchema,
  errorResponseSchema,
  idParamSchema,
  inviteAdminBodySchema,
  setAdminRolesBodySchema,
} from '@healthy-aahar/contracts';
import { businessScope, DomainError, type AdminUserRow } from '@healthy-aahar/core';
import { Hono } from 'hono';

import { registerRoute } from '../../lib/route-registry.js';
import type { AppBindings } from '../../types.js';

const jsonError = (description: string) => ({ description, schema: errorResponseSchema });

/**
 * Staff administration (docs/06 §11.8, docs/08 §6). There is no public
 * admin sign-up route anywhere in this API — every admin account is created
 * here, invite-only (docs/07 §5.1).
 */

registerRoute({
  method: 'GET',
  path: '/v1/admin/admin-users',
  audience: 'admin',
  permission: 'admin_users:read',
  summary: 'List staff accounts',
  phase: '03',
  openapi: {
    tags: ['Admin: Staff'],
    responses: { 200: { description: 'Staff accounts', schema: adminUserListResponseSchema } },
  },
});

registerRoute({
  method: 'POST',
  path: '/v1/admin/admin-users',
  audience: 'admin',
  permission: 'admin_users:create',
  summary: 'Invite a staff member (creates the Firebase admin user + assigns roles)',
  phase: '03',
  errors: ['FORBIDDEN', 'VALIDATION_FAILED'],
  openapi: {
    tags: ['Admin: Staff'],
    request: { body: inviteAdminBodySchema },
    responses: {
      201: { description: 'Invited', schema: adminUserSchema },
      403: jsonError('Only a Super Admin may grant role management or Super Admin access'),
      422: jsonError('Validation failed'),
    },
  },
});

registerRoute({
  method: 'POST',
  path: '/v1/admin/admin-users/{id}/roles',
  audience: 'admin',
  permission: 'admin_users:update',
  summary: "Replace a staff member's roles",
  phase: '03',
  errors: ['FORBIDDEN', 'NOT_FOUND', 'CANNOT_MODIFY_OWN_ROLES', 'LAST_SUPER_ADMIN'],
  openapi: {
    tags: ['Admin: Staff'],
    request: { params: idParamSchema, body: setAdminRolesBodySchema },
    responses: {
      200: { description: 'Roles updated', schema: adminUserSchema },
      403: jsonError('Forbidden — includes attempting to modify your own roles'),
      404: jsonError('Not found'),
      409: jsonError('Would leave the business with no active Super Admin'),
    },
  },
});

registerRoute({
  method: 'POST',
  path: '/v1/admin/admin-users/{id}/deactivate',
  audience: 'admin',
  permission: 'admin_users:deactivate',
  summary: 'Deactivate a staff account (revokes Firebase sessions immediately)',
  phase: '03',
  errors: ['NOT_FOUND', 'LAST_SUPER_ADMIN'],
  openapi: {
    tags: ['Admin: Staff'],
    request: { params: idParamSchema },
    responses: {
      200: { description: 'Deactivated', schema: adminUserSchema },
      404: jsonError('Not found'),
      409: jsonError('Would leave the business with no active Super Admin'),
    },
  },
});

function toResponse(row: AdminUserRow) {
  return {
    id: row.id,
    user_id: row.userId,
    email: row.email,
    full_name: row.fullName,
    designation: row.designation,
    is_super_admin: row.isSuperAdmin,
    roles: row.roleKeys,
    deactivated: row.deletedAt !== null,
  };
}

export function adminUsersRoutes(): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.get('/', async (c) => {
    const scope = businessScope(c.env.businessId);
    const rows = await c.env.services.rbac.admins.list(scope);
    return c.json({ data: rows.map(toResponse) });
  });

  app.post('/', async (c) => {
    const body = inviteAdminBodySchema.parse(await c.req.json());
    const actor = c.get('actor');
    if (actor.kind !== 'ADMIN') throw new DomainError('UNAUTHENTICATED', 'Not authenticated.');

    const scope = businessScope(c.env.businessId);
    const { admin } = await c.env.services.rbac.inviteAdmin(scope, {
      email: body.email,
      fullName: body.full_name,
      designation: body.designation,
      roleIds: body.role_ids,
      invitedByUserId: actor.userId,
      invitedByIsSuperAdmin: actor.isSuperAdmin,
    });

    return c.json(toResponse(admin), 201);
  });

  app.post('/:id/roles', async (c) => {
    const params = idParamSchema.parse({ id: c.req.param('id') });
    const body = setAdminRolesBodySchema.parse(await c.req.json());
    const actor = c.get('actor');
    if (actor.kind !== 'ADMIN') throw new DomainError('UNAUTHENTICATED', 'Not authenticated.');

    const scope = businessScope(c.env.businessId);
    const updated = await c.env.services.rbac.setRoles(scope, {
      targetAdminUserId: params.id,
      roleIds: body.role_ids,
      actorAdminUserId: actor.adminUserId,
      actorUserId: actor.userId,
      actorIsSuperAdmin: actor.isSuperAdmin,
    });

    return c.json(toResponse(updated));
  });

  app.post('/:id/deactivate', async (c) => {
    const params = idParamSchema.parse({ id: c.req.param('id') });
    const actor = c.get('actor');
    if (actor.kind !== 'ADMIN') throw new DomainError('UNAUTHENTICATED', 'Not authenticated.');

    const scope = businessScope(c.env.businessId);
    const target = await c.env.services.rbac.admins.findById(scope, params.id);
    if (!target) throw new DomainError('NOT_FOUND', 'Admin user not found.');

    const updated = await c.env.services.rbac.deactivate(scope, {
      targetAdminUserId: params.id,
      targetFirebaseUid: target.firebaseUid,
      actorUserId: actor.userId,
    });

    return c.json(toResponse(updated));
  });

  return app;
}
