import {
  adminDeliverySlotListResponseSchema,
  adminDeliverySlotSchema,
  createDeliverySlotBodySchema,
  errorResponseSchema,
  updateDeliverySlotBodySchema,
} from '@healthy-aahar/contracts';
import { businessScope, toAdminDeliverySlotView } from '@healthy-aahar/core';
import { Hono } from 'hono';

import { registerRoute } from '../../lib/route-registry.js';
import type { AppBindings } from '../../types.js';

const jsonError = (description: string) => ({ description, schema: errorResponseSchema });

/**
 * Founder/admin delivery-slot management (Phase 04 — delivery-slot-only;
 * see docs/PHASE-04-STOREFRONT-IMPLEMENTATION-REPORT.md §15). Reuses the
 * existing `delivery:read`/`delivery:manage` permissions the city/pincode
 * admin screens already use — this is the same "delivery configuration"
 * surface, not a new one.
 */

registerRoute({
  method: 'GET',
  path: '/v1/admin/delivery-slots',
  audience: 'admin',
  permission: 'delivery:read',
  summary: 'List delivery slots',
  phase: '04',
  openapi: {
    tags: ['Admin: Delivery Slots'],
    responses: {
      200: { description: 'Delivery slots', schema: adminDeliverySlotListResponseSchema },
    },
  },
});

registerRoute({
  method: 'POST',
  path: '/v1/admin/delivery-slots',
  audience: 'admin',
  permission: 'delivery:manage',
  summary: 'Create a delivery slot',
  phase: '04',
  errors: ['SLUG_ALREADY_IN_USE', 'VALIDATION_FAILED'],
  openapi: {
    tags: ['Admin: Delivery Slots'],
    request: { body: createDeliverySlotBodySchema },
    responses: {
      201: { description: 'Created', schema: adminDeliverySlotSchema },
      409: jsonError('Code already in use'),
      422: jsonError('Invalid time range, capacity, or available days'),
    },
  },
});

registerRoute({
  method: 'GET',
  path: '/v1/admin/delivery-slots/{id}',
  audience: 'admin',
  permission: 'delivery:read',
  summary: 'Get a delivery slot',
  phase: '04',
  errors: ['NOT_FOUND'],
  openapi: {
    tags: ['Admin: Delivery Slots'],
    responses: {
      200: { description: 'Delivery slot', schema: adminDeliverySlotSchema },
      404: jsonError('Not found'),
    },
  },
});

registerRoute({
  method: 'PATCH',
  path: '/v1/admin/delivery-slots/{id}',
  audience: 'admin',
  permission: 'delivery:manage',
  summary: 'Update a delivery slot (label, times, capacity, active state)',
  phase: '04',
  errors: ['NOT_FOUND', 'VALIDATION_FAILED'],
  openapi: {
    tags: ['Admin: Delivery Slots'],
    request: { body: updateDeliverySlotBodySchema },
    responses: { 200: { description: 'Updated', schema: adminDeliverySlotSchema } },
  },
});

export function adminDeliverySlotsRoutes(): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.get('/delivery-slots', async (c) => {
    const slots = await c.env.services.adminDeliverySlots.list(businessScope(c.env.businessId));
    return c.json({ data: slots.map(toAdminDeliverySlotView) });
  });

  app.post('/delivery-slots', async (c) => {
    const body = createDeliverySlotBodySchema.parse(await c.req.json());
    const actor = c.get('actor');
    if (actor.kind !== 'ADMIN') throw new Error('unreachable: adminAuth guarantees ADMIN');

    const slot = await c.env.services.adminDeliverySlots.create(
      businessScope(c.env.businessId),
      {
        name: body.name,
        code: body.code,
        startTime: body.start_time,
        endTime: body.end_time,
        cutoffTime: body.cutoff_time,
        cutoffDaysBefore: body.cutoff_days_before,
        availableDays: body.available_days,
        defaultCapacity: body.default_capacity,
        deliveryFeePaise: body.delivery_fee_paise,
        minOrderValuePaise: body.min_order_value_paise,
        displayOrder: body.display_order,
      },
      actor.userId,
    );
    return c.json(toAdminDeliverySlotView(slot), 201);
  });

  app.get('/delivery-slots/:id', async (c) => {
    const slot = await c.env.services.adminDeliverySlots.get(
      businessScope(c.env.businessId),
      c.req.param('id'),
    );
    return c.json(toAdminDeliverySlotView(slot));
  });

  app.patch('/delivery-slots/:id', async (c) => {
    const body = updateDeliverySlotBodySchema.parse(await c.req.json());
    const actor = c.get('actor');
    if (actor.kind !== 'ADMIN') throw new Error('unreachable: adminAuth guarantees ADMIN');

    const slot = await c.env.services.adminDeliverySlots.update(
      businessScope(c.env.businessId),
      c.req.param('id'),
      {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.start_time !== undefined ? { startTime: body.start_time } : {}),
        ...(body.end_time !== undefined ? { endTime: body.end_time } : {}),
        ...(body.cutoff_time !== undefined ? { cutoffTime: body.cutoff_time } : {}),
        ...(body.cutoff_days_before !== undefined
          ? { cutoffDaysBefore: body.cutoff_days_before }
          : {}),
        ...(body.available_days !== undefined ? { availableDays: body.available_days } : {}),
        ...(body.default_capacity !== undefined ? { defaultCapacity: body.default_capacity } : {}),
        ...(body.delivery_fee_paise !== undefined
          ? { deliveryFeePaise: body.delivery_fee_paise }
          : {}),
        ...(body.min_order_value_paise !== undefined
          ? { minOrderValuePaise: body.min_order_value_paise }
          : {}),
        ...(body.display_order !== undefined ? { displayOrder: body.display_order } : {}),
        ...(body.is_active !== undefined ? { isActive: body.is_active } : {}),
      },
      actor.userId,
    );
    return c.json(toAdminDeliverySlotView(slot));
  });

  return app;
}
