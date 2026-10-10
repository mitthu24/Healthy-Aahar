import {
  addressListResponseSchema,
  addressSchema,
  createAddressBodySchema,
  errorResponseSchema,
  updateAddressBodySchema,
} from '@healthy-aahar/contracts';
import { businessScope, type AddressRow } from '@healthy-aahar/core';
import { Hono } from 'hono';

import { registerRoute } from '../../lib/route-registry.js';
import type { AppBindings } from '../../types.js';

const jsonError = (description: string) => ({ description, schema: errorResponseSchema });

registerRoute({
  method: 'GET',
  path: '/v1/me/addresses',
  audience: 'customer',
  summary: 'List my addresses',
  phase: '04',
  openapi: {
    tags: ['Addresses'],
    responses: { 200: { description: 'Addresses', schema: addressListResponseSchema } },
  },
});

registerRoute({
  method: 'POST',
  path: '/v1/me/addresses',
  audience: 'customer',
  summary: 'Create an address',
  phase: '04',
  openapi: {
    tags: ['Addresses'],
    request: { body: createAddressBodySchema },
    responses: { 201: { description: 'Created', schema: addressSchema } },
  },
});

registerRoute({
  method: 'PATCH',
  path: '/v1/me/addresses/{id}',
  audience: 'customer',
  summary: 'Update an address',
  phase: '04',
  errors: ['NOT_FOUND'],
  openapi: {
    tags: ['Addresses'],
    request: { body: updateAddressBodySchema },
    responses: {
      200: { description: 'Updated', schema: addressSchema },
      404: jsonError('Not found'),
    },
  },
});

registerRoute({
  method: 'DELETE',
  path: '/v1/me/addresses/{id}',
  audience: 'customer',
  summary: 'Delete an address',
  phase: '04',
  errors: ['NOT_FOUND'],
  openapi: {
    tags: ['Addresses'],
    responses: { 204: { description: 'Deleted' }, 404: jsonError('Not found') },
  },
});

function toDto(row: AddressRow) {
  return {
    id: row.id,
    label: row.label,
    recipient_name: row.recipientName,
    recipient_phone: row.recipientPhone,
    line1: row.line1,
    line2: row.line2,
    landmark: row.landmark,
    city: row.city,
    state: row.state,
    pincode: row.pincode,
    country: row.country,
    delivery_instructions: row.deliveryInstructions,
    is_default: row.isDefault,
    is_serviceable: row.deliveryZoneId !== null,
    delivery_zone_id: row.deliveryZoneId,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

export function addressesRoutes(): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.get('/', async (c) => {
    const actor = c.get('actor');
    if (actor.kind !== 'CUSTOMER') throw new Error('unreachable: customerAuth guarantees CUSTOMER');

    const addresses = await c.env.services.address.list(
      businessScope(c.env.businessId),
      actor.customerProfileId,
    );
    return c.json({
      data: addresses.map(toDto),
      pagination: { limit: addresses.length, next_cursor: null, has_more: false },
    });
  });

  app.post('/', async (c) => {
    const actor = c.get('actor');
    if (actor.kind !== 'CUSTOMER') throw new Error('unreachable: customerAuth guarantees CUSTOMER');

    const body = createAddressBodySchema.parse(await c.req.json());
    const address = await c.env.services.address.create(
      businessScope(c.env.businessId),
      actor.customerProfileId,
      {
        label: body.label,
        recipientName: body.recipient_name,
        recipientPhone: body.recipient_phone,
        line1: body.line1,
        line2: body.line2,
        landmark: body.landmark,
        city: body.city,
        state: body.state,
        pincode: body.pincode,
        deliveryInstructions: body.delivery_instructions,
        isDefault: body.is_default,
      },
    );
    return c.json(toDto(address), 201);
  });

  app.patch('/:id', async (c) => {
    const actor = c.get('actor');
    if (actor.kind !== 'CUSTOMER') throw new Error('unreachable: customerAuth guarantees CUSTOMER');

    const body = updateAddressBodySchema.parse(await c.req.json());
    const address = await c.env.services.address.update(
      businessScope(c.env.businessId),
      actor.customerProfileId,
      c.req.param('id'),
      {
        ...(body.label !== undefined ? { label: body.label } : {}),
        ...(body.recipient_name !== undefined ? { recipientName: body.recipient_name } : {}),
        ...(body.recipient_phone !== undefined ? { recipientPhone: body.recipient_phone } : {}),
        ...(body.line1 !== undefined ? { line1: body.line1 } : {}),
        ...(body.line2 !== undefined ? { line2: body.line2 } : {}),
        ...(body.landmark !== undefined ? { landmark: body.landmark } : {}),
        ...(body.city !== undefined ? { city: body.city } : {}),
        ...(body.state !== undefined ? { state: body.state } : {}),
        ...(body.pincode !== undefined ? { pincode: body.pincode } : {}),
        ...(body.delivery_instructions !== undefined
          ? { deliveryInstructions: body.delivery_instructions }
          : {}),
        ...(body.is_default !== undefined ? { isDefault: body.is_default } : {}),
      },
    );
    return c.json(toDto(address));
  });

  app.delete('/:id', async (c) => {
    const actor = c.get('actor');
    if (actor.kind !== 'CUSTOMER') throw new Error('unreachable: customerAuth guarantees CUSTOMER');

    await c.env.services.address.delete(
      businessScope(c.env.businessId),
      actor.customerProfileId,
      c.req.param('id'),
    );
    return c.body(null, 204);
  });

  return app;
}
