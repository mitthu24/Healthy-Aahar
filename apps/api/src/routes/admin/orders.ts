import {
  adminOrderListResponseSchema,
  adminOrderSchema,
  errorResponseSchema,
  holdOrderBodySchema,
  listAdminOrdersQuerySchema,
  recordCodCollectionBodySchema,
  rejectOrderBodySchema,
  updateOrderStatusBodySchema,
} from '@healthy-aahar/contracts';
import { businessScope } from '@healthy-aahar/core';
import { Hono } from 'hono';

import { registerRoute } from '../../lib/route-registry.js';
import type { AppBindings } from '../../types.js';

/**
 * Admin order fulfilment (docs/15 §4.1; Phase 04 requirement change).
 *
 * No "accept"/"confirm" route exists here on purpose: checkout already
 * auto-confirms a COD order. Admin manages fulfilment (prepare, dispatch,
 * deliver), can reject/cancel when delivery turns out infeasible, can hold
 * an order for review without touching its status, and records COD
 * collection — a payment-side fact, kept separate from delivery status.
 */

const jsonError = (description: string) => ({ description, schema: errorResponseSchema });

registerRoute({
  method: 'GET',
  path: '/v1/admin/orders',
  audience: 'admin',
  permission: 'orders:read',
  summary: 'List orders',
  phase: '04',
  openapi: {
    tags: ['Admin: Orders'],
    request: { query: listAdminOrdersQuerySchema },
    responses: { 200: { description: 'Orders', schema: adminOrderListResponseSchema } },
  },
});

registerRoute({
  method: 'GET',
  path: '/v1/admin/orders/{id}',
  audience: 'admin',
  permission: 'orders:read',
  summary: 'Get an order',
  phase: '04',
  errors: ['NOT_FOUND'],
  openapi: {
    tags: ['Admin: Orders'],
    responses: {
      200: { description: 'Order', schema: adminOrderSchema },
      404: jsonError('Not found'),
    },
  },
});

registerRoute({
  method: 'POST',
  path: '/v1/admin/orders/{id}/status',
  audience: 'admin',
  permission: 'orders:update_status',
  summary: 'Move an order through fulfilment (preparing / dispatch / delivered)',
  phase: '04',
  errors: ['INVALID_STATUS_TRANSITION', 'VALIDATION_FAILED'],
  openapi: {
    tags: ['Admin: Orders'],
    request: { body: updateOrderStatusBodySchema },
    responses: {
      200: { description: 'Order updated', schema: adminOrderSchema },
      409: jsonError('Invalid transition'),
    },
  },
});

registerRoute({
  method: 'POST',
  path: '/v1/admin/orders/{id}/reject',
  audience: 'admin',
  permission: 'orders:cancel',
  summary: 'Reject a confirmed order (delivery infeasible) — a reasoned cancellation',
  phase: '04',
  errors: ['ORDER_NOT_CANCELLABLE'],
  openapi: {
    tags: ['Admin: Orders'],
    request: { body: rejectOrderBodySchema },
    responses: {
      200: { description: 'Order rejected', schema: adminOrderSchema },
      409: jsonError('Not cancellable'),
    },
  },
});

registerRoute({
  method: 'POST',
  path: '/v1/admin/orders/{id}/hold',
  audience: 'admin',
  permission: 'orders:update',
  summary: 'Flag an order for operational follow-up without changing its status',
  phase: '04',
  openapi: {
    tags: ['Admin: Orders'],
    request: { body: holdOrderBodySchema },
    responses: { 200: { description: 'Order flagged', schema: adminOrderSchema } },
  },
});

registerRoute({
  method: 'POST',
  path: '/v1/admin/orders/{id}/cod-collection',
  audience: 'admin',
  permission: 'payments:collect',
  summary: 'Record COD collection for an order',
  phase: '04',
  errors: ['VALIDATION_FAILED'],
  openapi: {
    tags: ['Admin: Orders'],
    request: { body: recordCodCollectionBodySchema },
    responses: { 200: { description: 'Collection recorded', schema: adminOrderSchema } },
  },
});

export function adminOrdersRoutes(): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.get('/orders', async (c) => {
    const query = listAdminOrdersQuerySchema.parse({
      limit: c.req.query('limit'),
      cursor: c.req.query('cursor'),
      status: c.req.query('status'),
      assigned_partner_id: c.req.query('assigned_partner_id'),
      unassigned: c.req.query('unassigned'),
    });

    const page = await c.env.services.orderFulfilment.list(businessScope(c.env.businessId), {
      limit: query.limit,
      cursor: query.cursor,
      status: query.status,
      assignedPartnerId: query.assigned_partner_id,
      unassigned: query.unassigned,
    });
    return c.json(page);
  });

  app.get('/orders/:id', async (c) => {
    const order = await c.env.services.orderFulfilment.get(
      businessScope(c.env.businessId),
      c.req.param('id'),
    );
    return c.json(order);
  });

  app.post('/orders/:id/status', async (c) => {
    const actor = c.get('actor');
    if (actor.kind !== 'ADMIN') throw new Error('unreachable: adminAuth guarantees ADMIN');

    const body = updateOrderStatusBodySchema.parse(await c.req.json());
    const order = await c.env.services.orderFulfilment.updateStatus(
      businessScope(c.env.businessId),
      c.req.param('id'),
      actor.adminUserId,
      body.to_status,
      body.reason,
    );
    return c.json(order);
  });

  app.post('/orders/:id/reject', async (c) => {
    const actor = c.get('actor');
    if (actor.kind !== 'ADMIN') throw new Error('unreachable: adminAuth guarantees ADMIN');

    const body = rejectOrderBodySchema.parse(await c.req.json());
    const order = await c.env.services.orderFulfilment.reject(
      businessScope(c.env.businessId),
      c.req.param('id'),
      actor.adminUserId,
      body.reason,
    );
    return c.json(order);
  });

  app.post('/orders/:id/hold', async (c) => {
    const actor = c.get('actor');
    if (actor.kind !== 'ADMIN') throw new Error('unreachable: adminAuth guarantees ADMIN');

    const body = holdOrderBodySchema.parse(await c.req.json());
    const order = await c.env.services.orderFulfilment.hold(
      businessScope(c.env.businessId),
      c.req.param('id'),
      actor.adminUserId,
      body.note,
    );
    return c.json(order);
  });

  app.post('/orders/:id/cod-collection', async (c) => {
    const actor = c.get('actor');
    if (actor.kind !== 'ADMIN') throw new Error('unreachable: adminAuth guarantees ADMIN');

    const body = recordCodCollectionBodySchema.parse(await c.req.json());
    const order = await c.env.services.orderFulfilment.recordCodCollection(
      businessScope(c.env.businessId),
      c.req.param('id'),
      actor.adminUserId,
      BigInt(body.amount_paise),
    );
    return c.json(order);
  });

  return app;
}
