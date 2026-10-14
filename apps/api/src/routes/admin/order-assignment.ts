import {
  adminOrderSchema,
  assignOrderBodySchema,
  assignmentHistoryResponseSchema,
  errorResponseSchema,
  idParamSchema,
} from '@healthy-aahar/contracts';
import { businessScope } from '@healthy-aahar/core';
import { Hono } from 'hono';

import { registerRoute } from '../../lib/route-registry.js';
import type { AppBindings } from '../../types.js';

/** Order ↔ delivery-partner assignment, admin side (PHASE 06). */

const jsonError = (description: string) => ({ description, schema: errorResponseSchema });

registerRoute({
  method: 'POST',
  path: '/v1/admin/orders/{id}/assign',
  audience: 'admin',
  permission: 'orders:assign',
  summary: 'Assign (or reassign) an order to a delivery partner',
  phase: '06',
  errors: [
    'NOT_FOUND',
    'PARTNER_NOT_FOUND',
    'PARTNER_OFF_DUTY',
    'ORDER_NOT_ASSIGNABLE',
    'VALIDATION_FAILED',
  ],
  openapi: {
    tags: ['Admin: Order Assignment'],
    request: { params: idParamSchema, body: assignOrderBodySchema },
    responses: {
      200: { description: 'Assigned', schema: adminOrderSchema },
      404: jsonError('Order or partner not found'),
      409: jsonError('Partner off duty, or order not in an assignable status'),
      422: jsonError('A reason is required to reassign an already-assigned order'),
    },
  },
});

registerRoute({
  method: 'GET',
  path: '/v1/admin/orders/{id}/assignment-history',
  audience: 'admin',
  permission: 'orders:assign',
  summary: 'View the full assignment history for an order',
  phase: '06',
  errors: ['NOT_FOUND'],
  openapi: {
    tags: ['Admin: Order Assignment'],
    request: { params: idParamSchema },
    responses: {
      200: { description: 'Assignment history', schema: assignmentHistoryResponseSchema },
      404: jsonError('Order not found'),
    },
  },
});

export function adminOrderAssignmentRoutes(): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.post('/orders/:id/assign', async (c) => {
    const params = idParamSchema.parse({ id: c.req.param('id') });
    const body = assignOrderBodySchema.parse(await c.req.json());
    const actor = c.get('actor');
    if (actor.kind !== 'ADMIN') throw new Error('unreachable: adminAuth guarantees ADMIN');

    const order = await c.env.services.orderAssignment.assign(businessScope(c.env.businessId), {
      orderId: params.id,
      partnerAdminUserId: body.partner_admin_user_id,
      actorUserId: actor.userId,
      reason: body.reason,
    });
    return c.json(order);
  });

  app.get('/orders/:id/assignment-history', async (c) => {
    const params = idParamSchema.parse({ id: c.req.param('id') });
    const rows = await c.env.services.orderAssignment.history(
      businessScope(c.env.businessId),
      params.id,
    );
    return c.json({
      data: rows.map((row) => ({
        id: row.id,
        partner_admin_user_id: row.partnerAdminUserId,
        partner_name: row.partnerName,
        status: row.status,
        reason: row.reason,
        assigned_at: row.assignedAt.toISOString(),
        ended_at: row.endedAt?.toISOString() ?? null,
      })),
    });
  });

  return app;
}
