import {
  adminUserListResponseSchema,
  adminUserSchema,
  errorResponseSchema,
  idParamSchema,
  inviteAdminBodySchema,
  inviteAdminResponseSchema,
  listAdminUsersQuerySchema,
  passwordSetupLinkResponseSchema,
  resetAdminPasswordBodySchema,
  setAdminRolesBodySchema,
  updateAdminDetailsBodySchema,
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
  summary: 'List staff accounts (optionally filtered by name/email)',
  phase: '03',
  openapi: {
    tags: ['Admin: Staff'],
    request: { query: listAdminUsersQuerySchema },
    responses: { 200: { description: 'Staff accounts', schema: adminUserListResponseSchema } },
  },
});

registerRoute({
  method: 'GET',
  path: '/v1/admin/admin-users/{id}',
  audience: 'admin',
  permission: 'admin_users:read',
  summary: 'Get a single staff account',
  phase: '05',
  errors: ['NOT_FOUND'],
  openapi: {
    tags: ['Admin: Staff'],
    request: { params: idParamSchema },
    responses: {
      200: { description: 'Staff account', schema: adminUserSchema },
      404: jsonError('Not found'),
    },
  },
});

registerRoute({
  method: 'PATCH',
  path: '/v1/admin/admin-users/{id}',
  audience: 'admin',
  permission: 'admin_users:update',
  summary: "Update a staff member's name, designation, or department (never roles)",
  phase: '05',
  errors: ['NOT_FOUND', 'VALIDATION_FAILED'],
  openapi: {
    tags: ['Admin: Staff'],
    request: { params: idParamSchema, body: updateAdminDetailsBodySchema },
    responses: {
      200: { description: 'Updated', schema: adminUserSchema },
      404: jsonError('Not found'),
    },
  },
});

registerRoute({
  method: 'POST',
  path: '/v1/admin/admin-users',
  audience: 'admin',
  permission: 'admin_users:create',
  summary: 'Invite a staff member (creates the user row + assigns roles; no password until setup)',
  phase: '03',
  errors: ['FORBIDDEN', 'VALIDATION_FAILED', 'ADMIN_ALREADY_INVITED', 'LOGIN_ID_TAKEN'],
  openapi: {
    tags: ['Admin: Staff'],
    request: { body: inviteAdminBodySchema },
    responses: {
      201: { description: 'Invited', schema: inviteAdminResponseSchema },
      403: jsonError('Only a Super Admin may grant role management or Super Admin access'),
      409: jsonError('An admin account with this email or login ID already exists'),
      422: jsonError('Validation failed'),
    },
  },
});

registerRoute({
  method: 'POST',
  path: '/v1/admin/admin-users/{id}/reset-password',
  audience: 'admin',
  permission: 'admin_users:update',
  summary: 'Issue a new password-setup token for an existing staff member (Fix #2)',
  phase: '03',
  errors: ['NOT_FOUND'],
  openapi: {
    tags: ['Admin: Staff'],
    request: { params: idParamSchema, body: resetAdminPasswordBodySchema },
    responses: {
      200: { description: 'Token issued', schema: passwordSetupLinkResponseSchema },
      404: jsonError('Not found'),
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
  summary: 'Deactivate a staff account (revokes every active session immediately)',
  phase: '03',
  errors: ['NOT_FOUND', 'LAST_SUPER_ADMIN', 'CANNOT_DEACTIVATE_SELF'],
  openapi: {
    tags: ['Admin: Staff'],
    request: { params: idParamSchema },
    responses: {
      200: { description: 'Deactivated', schema: adminUserSchema },
      403: jsonError('Cannot deactivate your own account'),
      404: jsonError('Not found'),
      409: jsonError('Would leave the business with no active Super Admin'),
    },
  },
});

registerRoute({
  method: 'POST',
  path: '/v1/admin/admin-users/{id}/reactivate',
  audience: 'admin',
  permission: 'admin_users:deactivate',
  summary: 'Reactivate a previously deactivated staff account',
  phase: '05',
  errors: ['NOT_FOUND', 'VALIDATION_FAILED'],
  openapi: {
    tags: ['Admin: Staff'],
    request: { params: idParamSchema },
    responses: {
      200: { description: 'Reactivated', schema: adminUserSchema },
      404: jsonError('Not found'),
      422: jsonError('Account is already active'),
    },
  },
});

function toResponse(row: AdminUserRow) {
  return {
    id: row.id,
    user_id: row.userId,
    email: row.email,
    login_id: row.loginId,
    full_name: row.fullName,
    designation: row.designation,
    department: row.department,
    is_super_admin: row.isSuperAdmin,
    roles: row.roleKeys,
    deactivated: row.deletedAt !== null,
  };
}

export function adminUsersRoutes(): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.get('/', async (c) => {
    const query = listAdminUsersQuerySchema.parse(c.req.query());
    const scope = businessScope(c.env.businessId);
    const rows = await c.env.services.rbac.admins.list(scope, { q: query.q });
    return c.json({ data: rows.map(toResponse) });
  });

  app.get('/:id', async (c) => {
    const params = idParamSchema.parse({ id: c.req.param('id') });
    const scope = businessScope(c.env.businessId);
    const admin = await c.env.services.rbac.admins.findById(scope, params.id);
    if (!admin) throw new DomainError('NOT_FOUND', 'Admin user not found.');
    return c.json(toResponse(admin));
  });

  app.post('/', async (c) => {
    const body = inviteAdminBodySchema.parse(await c.req.json());
    const actor = c.get('actor');
    if (actor.kind !== 'ADMIN') throw new DomainError('UNAUTHENTICATED', 'Not authenticated.');

    const scope = businessScope(c.env.businessId);
    const { admin, passwordResetLink } = await c.env.services.rbac.inviteAdmin(scope, {
      email: body.email,
      loginId: body.login_id,
      fullName: body.full_name,
      designation: body.designation,
      department: body.department,
      roleIds: body.role_ids,
      invitedByUserId: actor.userId,
      invitedByIsSuperAdmin: actor.isSuperAdmin,
      passwordResetContinueUrl: body.password_setup_continue_url,
    });

    return c.json({ ...toResponse(admin), password_setup_link: passwordResetLink }, 201);
  });

  app.patch('/:id', async (c) => {
    const params = idParamSchema.parse({ id: c.req.param('id') });
    const body = updateAdminDetailsBodySchema.parse(await c.req.json());
    const actor = c.get('actor');
    if (actor.kind !== 'ADMIN') throw new DomainError('UNAUTHENTICATED', 'Not authenticated.');

    const scope = businessScope(c.env.businessId);
    const updated = await c.env.services.rbac.updateDetails(scope, {
      targetAdminUserId: params.id,
      fullName: body.full_name,
      designation: body.designation,
      department: body.department,
      actorUserId: actor.userId,
    });

    return c.json(toResponse(updated));
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

  app.post('/:id/reset-password', async (c) => {
    const params = idParamSchema.parse({ id: c.req.param('id') });
    const body = resetAdminPasswordBodySchema.parse(await c.req.json().catch(() => ({})));
    const actor = c.get('actor');
    if (actor.kind !== 'ADMIN') throw new DomainError('UNAUTHENTICATED', 'Not authenticated.');

    const scope = businessScope(c.env.businessId);
    const { passwordResetLink } = await c.env.services.rbac.resetAdminPassword(scope, {
      targetAdminUserId: params.id,
      actorUserId: actor.userId,
      passwordResetContinueUrl: body.password_setup_continue_url,
    });

    return c.json({ password_setup_link: passwordResetLink });
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
      actorAdminUserId: actor.adminUserId,
      actorUserId: actor.userId,
    });

    return c.json(toResponse(updated));
  });

  app.post('/:id/reactivate', async (c) => {
    const params = idParamSchema.parse({ id: c.req.param('id') });
    const actor = c.get('actor');
    if (actor.kind !== 'ADMIN') throw new DomainError('UNAUTHENTICATED', 'Not authenticated.');

    const scope = businessScope(c.env.businessId);
    const updated = await c.env.services.rbac.reactivate(scope, {
      targetAdminUserId: params.id,
      actorUserId: actor.userId,
    });

    return c.json(toResponse(updated));
  });

  return app;
}
