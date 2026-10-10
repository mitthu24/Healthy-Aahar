import { addCartItemBodySchema, cartSchema, errorResponseSchema, updateCartItemBodySchema } from '@healthy-aahar/contracts';
import { businessScope, type CartView } from '@healthy-aahar/core';
import { Hono } from 'hono';

import { registerRoute } from '../../lib/route-registry.js';
import type { AppBindings } from '../../types.js';

const jsonError = (description: string) => ({ description, schema: errorResponseSchema });

registerRoute({
  method: 'GET',
  path: '/v1/me/cart',
  audience: 'customer',
  summary: 'Get my cart',
  phase: '04',
  openapi: { tags: ['Cart'], responses: { 200: { description: 'Cart', schema: cartSchema } } },
});

registerRoute({
  method: 'POST',
  path: '/v1/me/cart/items',
  audience: 'customer',
  summary: 'Add an item to my cart',
  phase: '04',
  errors: ['VARIANT_NOT_FOUND'],
  openapi: {
    tags: ['Cart'],
    request: { body: addCartItemBodySchema },
    responses: { 200: { description: 'Cart', schema: cartSchema }, 404: jsonError('Variant not found') },
  },
});

registerRoute({
  method: 'PATCH',
  path: '/v1/me/cart/items/{id}',
  audience: 'customer',
  summary: 'Update a cart item quantity',
  phase: '04',
  errors: ['NOT_FOUND'],
  openapi: {
    tags: ['Cart'],
    request: { body: updateCartItemBodySchema },
    responses: { 200: { description: 'Cart', schema: cartSchema }, 404: jsonError('Not found') },
  },
});

registerRoute({
  method: 'DELETE',
  path: '/v1/me/cart/items/{id}',
  audience: 'customer',
  summary: 'Remove a cart item',
  phase: '04',
  openapi: { tags: ['Cart'], responses: { 200: { description: 'Cart', schema: cartSchema } } },
});

function toDto(cart: CartView) {
  return cart;
}

export function cartRoutes(): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.get('/', async (c) => {
    const actor = c.get('actor');
    if (actor.kind !== 'CUSTOMER') throw new Error('unreachable: customerAuth guarantees CUSTOMER');
    const cart = await c.env.services.cart.view(businessScope(c.env.businessId), actor.customerProfileId);
    return c.json(toDto(cart));
  });

  app.post('/items', async (c) => {
    const actor = c.get('actor');
    if (actor.kind !== 'CUSTOMER') throw new Error('unreachable: customerAuth guarantees CUSTOMER');
    const body = addCartItemBodySchema.parse(await c.req.json());
    const cart = await c.env.services.cart.addItem(
      businessScope(c.env.businessId),
      actor.customerProfileId,
      body.variant_id,
      body.quantity,
    );
    return c.json(toDto(cart));
  });

  app.patch('/items/:id', async (c) => {
    const actor = c.get('actor');
    if (actor.kind !== 'CUSTOMER') throw new Error('unreachable: customerAuth guarantees CUSTOMER');
    const body = updateCartItemBodySchema.parse(await c.req.json());
    const cart = await c.env.services.cart.updateItem(
      businessScope(c.env.businessId),
      actor.customerProfileId,
      c.req.param('id'),
      body.quantity,
    );
    return c.json(toDto(cart));
  });

  app.delete('/items/:id', async (c) => {
    const actor = c.get('actor');
    if (actor.kind !== 'CUSTOMER') throw new Error('unreachable: customerAuth guarantees CUSTOMER');
    const cart = await c.env.services.cart.removeItem(
      businessScope(c.env.businessId),
      actor.customerProfileId,
      c.req.param('id'),
    );
    return c.json(toDto(cart));
  });

  return app;
}
