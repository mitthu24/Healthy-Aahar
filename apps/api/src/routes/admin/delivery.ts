import {
  deliveryDashboardSchema,
  deliveryOrderListResponseSchema,
  deliveryOrderSchema,
  errorResponseSchema,
  failDeliveryBodySchema,
  idParamSchema,
  listMyDeliveriesQuerySchema,
  recordDeliveryCodCollectionBodySchema,
  updateDutyStatusBodySchema,
} from '@healthy-aahar/contracts';
import { businessScope } from '@healthy-aahar/core';
import { Hono } from 'hono';

import { registerRoute } from '../../lib/route-registry.js';
import type { AppBindings } from '../../types.js';

/**
 * Delivery partner's own self-service surface (PHASE 06) — lives under
 * `/v1/admin/delivery/*` rather than a separate audience: a partner IS an
 * admin session (same cookie, same `adminAuth`/`requirePermission`
 * middleware), gated entirely by the `deliveries:fulfil` permission the
 * DELIVERY_PARTNER role grants. Every handler scopes to the calling
 * partner's OWN `adminUserId` — never a path parameter for "which partner",
 * so there is no way to pass someone else's id in.
 */

const jsonError = (description: string) => ({ description, schema: errorResponseSchema });

registerRoute({
  method: 'GET',
  path: '/v1/admin/delivery/me',
  audience: 'admin',
  permission: 'deliveries:fulfil',
  summary: "The calling delivery partner's dashboard (duty status + workload summary)",
  phase: '06',
  errors: ['PARTNER_NOT_FOUND'],
  openapi: {
    tags: ['Delivery: Self-service'],
    responses: { 200: { description: 'Dashboard', schema: deliveryDashboardSchema } },
  },
});

registerRoute({
  method: 'POST',
  path: '/v1/admin/delivery/duty',
  audience: 'admin',
  permission: 'deliveries:fulfil',
  summary: 'Toggle on-duty / off-duty',
  phase: '06',
  errors: ['PARTNER_NOT_FOUND'],
  openapi: {
    tags: ['Delivery: Self-service'],
    request: { body: updateDutyStatusBodySchema },
    responses: { 200: { description: 'Duty status updated', schema: deliveryDashboardSchema } },
  },
});

registerRoute({
  method: 'GET',
  path: '/v1/admin/delivery/orders',
  audience: 'admin',
  permission: 'deliveries:fulfil',
  summary: 'List deliveries assigned to the calling partner',
  phase: '06',
  openapi: {
    tags: ['Delivery: Self-service'],
    request: { query: listMyDeliveriesQuerySchema },
    responses: {
      200: { description: 'Assigned deliveries', schema: deliveryOrderListResponseSchema },
    },
  },
});

registerRoute({
  method: 'GET',
  path: '/v1/admin/delivery/orders/{id}',
  audience: 'admin',
  permission: 'deliveries:fulfil',
  summary: 'Get one delivery assigned to the calling partner',
  phase: '06',
  errors: ['NOT_FOUND'],
  openapi: {
    tags: ['Delivery: Self-service'],
    request: { params: idParamSchema },
    responses: {
      200: { description: 'Delivery', schema: deliveryOrderSchema },
      404: jsonError('Not found, or not assigned to you'),
    },
  },
});

registerRoute({
  method: 'POST',
  path: '/v1/admin/delivery/orders/{id}/accept',
  audience: 'admin',
  permission: 'deliveries:fulfil',
  summary: 'Accept the assignment and start the trip (READY_FOR_DISPATCH → OUT_FOR_DELIVERY)',
  phase: '06',
  errors: ['NOT_FOUND', 'INVALID_STATUS_TRANSITION'],
  openapi: {
    tags: ['Delivery: Self-service'],
    request: { params: idParamSchema },
    responses: {
      200: { description: 'Dispatched', schema: deliveryOrderSchema },
      409: jsonError('Invalid transition'),
    },
  },
});

registerRoute({
  method: 'POST',
  path: '/v1/admin/delivery/orders/{id}/delivered',
  audience: 'admin',
  permission: 'deliveries:fulfil',
  summary: 'Mark delivered',
  phase: '06',
  errors: ['NOT_FOUND', 'INVALID_STATUS_TRANSITION'],
  openapi: {
    tags: ['Delivery: Self-service'],
    request: { params: idParamSchema },
    responses: {
      200: { description: 'Delivered', schema: deliveryOrderSchema },
      409: jsonError('Invalid transition'),
    },
  },
});

registerRoute({
  method: 'POST',
  path: '/v1/admin/delivery/orders/{id}/failed',
  audience: 'admin',
  permission: 'deliveries:fulfil',
  summary: 'Record a failed delivery attempt with a reason',
  phase: '06',
  errors: ['NOT_FOUND', 'INVALID_STATUS_TRANSITION', 'VALIDATION_FAILED'],
  openapi: {
    tags: ['Delivery: Self-service'],
    request: { params: idParamSchema, body: failDeliveryBodySchema },
    responses: {
      200: { description: 'Marked failed', schema: deliveryOrderSchema },
      409: jsonError('Invalid transition'),
    },
  },
});

registerRoute({
  method: 'POST',
  path: '/v1/admin/delivery/orders/{id}/cod-collection',
  audience: 'admin',
  permission: 'deliveries:fulfil',
  summary: 'Record COD collection for a delivery assigned to the calling partner',
  phase: '06',
  errors: ['NOT_FOUND', 'VALIDATION_FAILED'],
  openapi: {
    tags: ['Delivery: Self-service'],
    request: { params: idParamSchema, body: recordDeliveryCodCollectionBodySchema },
    responses: { 200: { description: 'Collection recorded', schema: deliveryOrderSchema } },
  },
});

export function deliveryRoutes(): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.get('/me', async (c) => {
    const actor = c.get('actor');
    if (actor.kind !== 'ADMIN') throw new Error('unreachable: adminAuth guarantees ADMIN');
    const dashboard = await c.env.services.deliveryFulfilment.getDashboard(
      businessScope(c.env.businessId),
      actor.adminUserId,
    );
    return c.json(dashboard);
  });

  app.post('/duty', async (c) => {
    const actor = c.get('actor');
    if (actor.kind !== 'ADMIN') throw new Error('unreachable: adminAuth guarantees ADMIN');
    const body = updateDutyStatusBodySchema.parse(await c.req.json());
    await c.env.services.deliveryFulfilment.setDutyStatus(
      businessScope(c.env.businessId),
      actor.adminUserId,
      body.duty_status,
    );
    const dashboard = await c.env.services.deliveryFulfilment.getDashboard(
      businessScope(c.env.businessId),
      actor.adminUserId,
    );
    return c.json(dashboard);
  });

  app.get('/orders', async (c) => {
    const actor = c.get('actor');
    if (actor.kind !== 'ADMIN') throw new Error('unreachable: adminAuth guarantees ADMIN');
    const query = listMyDeliveriesQuerySchema.parse({
      status: c.req.query('status'),
      limit: c.req.query('limit'),
      cursor: c.req.query('cursor'),
    });
    const page = await c.env.services.deliveryFulfilment.listMyDeliveries(
      businessScope(c.env.businessId),
      actor.adminUserId,
      query,
    );
    return c.json(page);
  });

  app.get('/orders/:id', async (c) => {
    const actor = c.get('actor');
    if (actor.kind !== 'ADMIN') throw new Error('unreachable: adminAuth guarantees ADMIN');
    const params = idParamSchema.parse({ id: c.req.param('id') });
    const order = await c.env.services.deliveryFulfilment.getMyDelivery(
      businessScope(c.env.businessId),
      actor.adminUserId,
      params.id,
    );
    return c.json(order);
  });

  app.post('/orders/:id/accept', async (c) => {
    const actor = c.get('actor');
    if (actor.kind !== 'ADMIN') throw new Error('unreachable: adminAuth guarantees ADMIN');
    const params = idParamSchema.parse({ id: c.req.param('id') });
    const order = await c.env.services.deliveryFulfilment.acceptAndDispatch(
      businessScope(c.env.businessId),
      actor.adminUserId,
      params.id,
    );
    return c.json(order);
  });

  app.post('/orders/:id/delivered', async (c) => {
    const actor = c.get('actor');
    if (actor.kind !== 'ADMIN') throw new Error('unreachable: adminAuth guarantees ADMIN');
    const params = idParamSchema.parse({ id: c.req.param('id') });
    const order = await c.env.services.deliveryFulfilment.markDelivered(
      businessScope(c.env.businessId),
      actor.adminUserId,
      params.id,
    );
    return c.json(order);
  });

  app.post('/orders/:id/failed', async (c) => {
    const actor = c.get('actor');
    if (actor.kind !== 'ADMIN') throw new Error('unreachable: adminAuth guarantees ADMIN');
    const params = idParamSchema.parse({ id: c.req.param('id') });
    const body = failDeliveryBodySchema.parse(await c.req.json());
    const order = await c.env.services.deliveryFulfilment.markFailed(
      businessScope(c.env.businessId),
      actor.adminUserId,
      params.id,
      body.reason,
    );
    return c.json(order);
  });

  app.post('/orders/:id/cod-collection', async (c) => {
    const actor = c.get('actor');
    if (actor.kind !== 'ADMIN') throw new Error('unreachable: adminAuth guarantees ADMIN');
    const params = idParamSchema.parse({ id: c.req.param('id') });
    const body = recordDeliveryCodCollectionBodySchema.parse(await c.req.json());
    const order = await c.env.services.deliveryFulfilment.recordCodCollection(
      businessScope(c.env.businessId),
      actor.adminUserId,
      params.id,
      BigInt(body.amount_paise),
    );
    return c.json(order);
  });

  return app;
}
