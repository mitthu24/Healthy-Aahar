import { createHash } from 'node:crypto';

import {
  checkoutBodySchema,
  errorResponseSchema,
  orderListResponseSchema,
  orderSchema,
} from '@healthy-aahar/contracts';
import { businessScope, DomainError } from '@healthy-aahar/core';
import { Hono } from 'hono';

import { registerRoute } from '../../lib/route-registry.js';
import type { AppBindings } from '../../types.js';

const jsonError = (description: string) => ({ description, schema: errorResponseSchema });

registerRoute({
  method: 'POST',
  path: '/v1/me/orders',
  audience: 'customer',
  summary: 'Checkout — place an order from my cart (COD, auto-confirmed)',
  phase: '04',
  idempotent: true,
  errors: [
    'CART_EMPTY',
    'ITEM_NOT_AVAILABLE',
    'INSUFFICIENT_STOCK',
    'MAX_QUANTITY_EXCEEDED',
    'ADDRESS_NOT_SERVICEABLE',
    'SLOT_NOT_AVAILABLE_ON_DAY',
    'MIN_ORDER_NOT_MET',
    'IDEMPOTENCY_KEY_REUSED',
    'IDEMPOTENT_REQUEST_IN_PROGRESS',
  ],
  openapi: {
    description:
      'Every price and stock check is re-read from the database inside one ' +
      'transaction; nothing the client sends for price is trusted. The order ' +
      'is auto-confirmed (PENDING -> CONFIRMED) in the same transaction — ' +
      'there is no separate admin "accept" step for a COD order.',
    tags: ['Orders'],
    request: { body: checkoutBodySchema },
    responses: {
      201: { description: 'Order placed and confirmed', schema: orderSchema },
      400: jsonError('Cart is empty'),
      409: jsonError('Insufficient stock, slot unavailable, or idempotency conflict'),
      422: jsonError('Validation failed'),
    },
  },
});

registerRoute({
  method: 'GET',
  path: '/v1/me/orders',
  audience: 'customer',
  summary: 'List my orders',
  phase: '04',
  openapi: {
    tags: ['Orders'],
    responses: { 200: { description: 'Orders', schema: orderListResponseSchema } },
  },
});

registerRoute({
  method: 'GET',
  path: '/v1/me/orders/{id}',
  audience: 'customer',
  summary: 'Get an order',
  phase: '04',
  errors: ['NOT_FOUND'],
  openapi: {
    tags: ['Orders'],
    responses: { 200: { description: 'Order', schema: orderSchema }, 404: jsonError('Not found') },
  },
});

registerRoute({
  method: 'POST',
  path: '/v1/me/orders/{id}/cancel',
  audience: 'customer',
  summary: 'Cancel my order (only while cancellable)',
  phase: '04',
  errors: ['ORDER_NOT_CANCELLABLE'],
  openapi: {
    tags: ['Orders'],
    responses: {
      200: { description: 'Order cancelled', schema: orderSchema },
      409: jsonError('Not cancellable'),
    },
  },
});

export function ordersRoutes(): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.post('/', async (c) => {
    const actor = c.get('actor');
    if (actor.kind !== 'CUSTOMER') throw new Error('unreachable: customerAuth guarantees CUSTOMER');

    const idempotencyKey = c.req.header('Idempotency-Key');
    if (!idempotencyKey) {
      throw new DomainError(
        'VALIDATION_FAILED',
        'An Idempotency-Key header is required to place an order.',
        {
          details: [{ field: 'Idempotency-Key', issue: 'header is required' }],
        },
      );
    }

    const rawBody = await c.req.text();
    const body = checkoutBodySchema.parse(JSON.parse(rawBody));
    // Binds the key to this exact payload — a retry with the same key and a
    // DIFFERENT body is a bug, not a legitimate retry (requirement 4, 12).
    const requestHash = createHash('sha256').update(rawBody).digest('hex');

    const order = await c.env.services.checkout.placeOrder(businessScope(c.env.businessId), {
      businessId: c.env.businessId,
      customerProfileId: actor.customerProfileId,
      addressId: body.address_id,
      deliverySlotId: body.delivery_slot_id,
      serviceDate: body.service_date,
      customerNote: body.customer_note,
      idempotencyKey,
      requestHash,
    });

    return c.json(order, 201);
  });

  app.get('/', async (c) => {
    const actor = c.get('actor');
    if (actor.kind !== 'CUSTOMER') throw new Error('unreachable: customerAuth guarantees CUSTOMER');

    const limit = Number(c.req.query('limit') ?? 20);
    const cursor = c.req.query('cursor');

    const page = await c.env.services.customerOrders.list(
      businessScope(c.env.businessId),
      actor.customerProfileId,
      {
        limit,
        ...(cursor ? { cursor } : {}),
      },
    );
    return c.json(page);
  });

  app.get('/:id', async (c) => {
    const actor = c.get('actor');
    if (actor.kind !== 'CUSTOMER') throw new Error('unreachable: customerAuth guarantees CUSTOMER');

    const order = await c.env.services.customerOrders.get(
      businessScope(c.env.businessId),
      actor.customerProfileId,
      c.req.param('id'),
    );
    return c.json(order);
  });

  app.post('/:id/cancel', async (c) => {
    const actor = c.get('actor');
    if (actor.kind !== 'CUSTOMER') throw new Error('unreachable: customerAuth guarantees CUSTOMER');

    const order = await c.env.services.customerOrders.cancel(
      businessScope(c.env.businessId),
      actor.customerProfileId,
      c.req.param('id'),
    );
    return c.json(order);
  });

  return app;
}
