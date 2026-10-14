import {
  createDeliveryPartnerBodySchema,
  createDeliveryPartnerResponseSchema,
  deliveryPartnerListResponseSchema,
  deliveryPartnerSchema,
  errorResponseSchema,
  idParamSchema,
  listDeliveryPartnersQuerySchema,
} from '@healthy-aahar/contracts';
import { businessScope, type DeliveryPartnerRow } from '@healthy-aahar/core';
import { Hono } from 'hono';

import { registerRoute } from '../../lib/route-registry.js';
import type { AppBindings } from '../../types.js';

/**
 * Admin-managed delivery-partner accounts (PHASE 06). A partner is an
 * AdminUser with the DELIVERY_PARTNER role — invite/suspend/reactivate reuse
 * RbacService wholesale via DeliveryPartnerService; only the profile data
 * (duty status, vehicle info) is new here.
 */

const jsonError = (description: string) => ({ description, schema: errorResponseSchema });

registerRoute({
  method: 'GET',
  path: '/v1/admin/delivery-partners',
  audience: 'admin',
  permission: 'delivery_partners:read',
  summary: 'List delivery partners (search by name/email, filter by duty status)',
  phase: '06',
  openapi: {
    tags: ['Admin: Delivery Partners'],
    request: { query: listDeliveryPartnersQuerySchema },
    responses: {
      200: { description: 'Delivery partners', schema: deliveryPartnerListResponseSchema },
    },
  },
});

registerRoute({
  method: 'GET',
  path: '/v1/admin/delivery-partners/{id}',
  audience: 'admin',
  permission: 'delivery_partners:read',
  summary: 'Get a single delivery partner',
  phase: '06',
  errors: ['PARTNER_NOT_FOUND'],
  openapi: {
    tags: ['Admin: Delivery Partners'],
    request: { params: idParamSchema },
    responses: {
      200: { description: 'Delivery partner', schema: deliveryPartnerSchema },
      404: jsonError('Not found'),
    },
  },
});

registerRoute({
  method: 'POST',
  path: '/v1/admin/delivery-partners',
  audience: 'admin',
  permission: 'delivery_partners:manage',
  summary: 'Create a delivery partner (invites the account + assigns DELIVERY_PARTNER role)',
  phase: '06',
  errors: ['VALIDATION_FAILED', 'ADMIN_ALREADY_INVITED'],
  openapi: {
    tags: ['Admin: Delivery Partners'],
    request: { body: createDeliveryPartnerBodySchema },
    responses: {
      201: { description: 'Created', schema: createDeliveryPartnerResponseSchema },
      409: jsonError('An admin account with this email already exists'),
    },
  },
});

registerRoute({
  method: 'POST',
  path: '/v1/admin/delivery-partners/{id}/suspend',
  audience: 'admin',
  permission: 'delivery_partners:manage',
  summary: 'Suspend a delivery partner (revokes every active session immediately)',
  phase: '06',
  errors: ['PARTNER_NOT_FOUND'],
  openapi: {
    tags: ['Admin: Delivery Partners'],
    request: { params: idParamSchema },
    responses: { 200: { description: 'Suspended', schema: deliveryPartnerSchema } },
  },
});

registerRoute({
  method: 'POST',
  path: '/v1/admin/delivery-partners/{id}/reactivate',
  audience: 'admin',
  permission: 'delivery_partners:manage',
  summary: 'Reactivate a suspended delivery partner',
  phase: '06',
  errors: ['PARTNER_NOT_FOUND', 'VALIDATION_FAILED'],
  openapi: {
    tags: ['Admin: Delivery Partners'],
    request: { params: idParamSchema },
    responses: { 200: { description: 'Reactivated', schema: deliveryPartnerSchema } },
  },
});

function toResponse(row: DeliveryPartnerRow) {
  return {
    id: row.adminUserId,
    full_name: row.fullName,
    email: row.email,
    employee_code: row.employeeCode,
    duty_status: row.dutyStatus,
    duty_changed_at: row.dutyChangedAt?.toISOString() ?? null,
    vehicle_type: row.vehicleType,
    vehicle_number: row.vehicleNumber,
    deactivated: row.deactivated,
    active_delivery_count: row.activeDeliveryCount,
  };
}

export function adminDeliveryPartnersRoutes(): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.get('/', async (c) => {
    const query = listDeliveryPartnersQuerySchema.parse({
      q: c.req.query('q'),
      duty_status: c.req.query('duty_status'),
    });
    const scope = businessScope(c.env.businessId);
    const rows = await c.env.services.deliveryPartners.list(scope, {
      q: query.q,
      dutyStatus: query.duty_status,
    });
    return c.json({
      data: rows.map(toResponse),
      pagination: { limit: rows.length, next_cursor: null, has_more: false },
    });
  });

  app.get('/:id', async (c) => {
    const params = idParamSchema.parse({ id: c.req.param('id') });
    const scope = businessScope(c.env.businessId);
    const partner = await c.env.services.deliveryPartners.get(scope, params.id);
    return c.json(toResponse(partner));
  });

  app.post('/', async (c) => {
    const body = createDeliveryPartnerBodySchema.parse(await c.req.json());
    const actor = c.get('actor');
    if (actor.kind !== 'ADMIN') throw new Error('unreachable: adminAuth guarantees ADMIN');

    const scope = businessScope(c.env.businessId);
    const { partner, passwordResetLink } = await c.env.services.deliveryPartners.create(scope, {
      email: body.email,
      fullName: body.full_name,
      employeeCode: body.employee_code,
      vehicleType: body.vehicle_type,
      vehicleNumber: body.vehicle_number,
      actorUserId: actor.userId,
    });

    return c.json({ ...toResponse(partner), password_setup_link: passwordResetLink }, 201);
  });

  app.post('/:id/suspend', async (c) => {
    const params = idParamSchema.parse({ id: c.req.param('id') });
    const actor = c.get('actor');
    if (actor.kind !== 'ADMIN') throw new Error('unreachable: adminAuth guarantees ADMIN');

    const scope = businessScope(c.env.businessId);
    const updated = await c.env.services.deliveryPartners.suspend(scope, {
      adminUserId: params.id,
      actorAdminUserId: actor.adminUserId,
      actorUserId: actor.userId,
    });
    return c.json(toResponse(updated));
  });

  app.post('/:id/reactivate', async (c) => {
    const params = idParamSchema.parse({ id: c.req.param('id') });
    const actor = c.get('actor');
    if (actor.kind !== 'ADMIN') throw new Error('unreachable: adminAuth guarantees ADMIN');

    const scope = businessScope(c.env.businessId);
    const updated = await c.env.services.deliveryPartners.reactivate(scope, {
      adminUserId: params.id,
      actorUserId: actor.userId,
    });
    return c.json(toResponse(updated));
  });

  return app;
}
