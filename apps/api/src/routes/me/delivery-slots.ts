import { deliverySlotListResponseSchema, errorResponseSchema } from '@healthy-aahar/contracts';
import { DomainError } from '@healthy-aahar/core';
import { Hono } from 'hono';

import { registerRoute } from '../../lib/route-registry.js';
import type { AppBindings } from '../../types.js';

const jsonError = (description: string) => ({ description, schema: errorResponseSchema });

/**
 * Delivery slots available for one of the customer's own addresses
 * (Phase 04). A minimal read, not the PHASE 06 slot-capacity system — see
 * the contract's doc comment for why that scope line is deliberate.
 */
registerRoute({
  method: 'GET',
  path: '/v1/me/delivery-slots',
  audience: 'customer',
  summary: "List delivery slots available for one of the customer's addresses",
  phase: '04',
  errors: ['NOT_FOUND', 'ADDRESS_NOT_SERVICEABLE'],
  openapi: {
    tags: ['Orders'],
    responses: {
      200: { description: 'Available slots', schema: deliverySlotListResponseSchema },
      404: jsonError('Address not found'),
      422: jsonError('Address is not assigned to a delivery zone'),
    },
  },
});

function formatTime(date: Date): string {
  return date.toISOString().slice(11, 16);
}

export function deliverySlotsRoutes(): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.get('/', async (c) => {
    const actor = c.get('actor');
    if (actor.kind !== 'CUSTOMER') throw new Error('unreachable: customerAuth guarantees CUSTOMER');

    const addressId = c.req.query('address_id');
    if (!addressId) {
      throw new DomainError('VALIDATION_FAILED', 'address_id is required.', {
        details: [{ field: 'address_id', issue: 'required' }],
      });
    }

    const address = await c.env.prisma.address.findFirst({
      where: { id: addressId, customerProfileId: actor.customerProfileId, deletedAt: null },
    });
    if (!address) throw new DomainError('NOT_FOUND', 'Address not found.');
    if (!address.deliveryZoneId) {
      throw new DomainError(
        'ADDRESS_NOT_SERVICEABLE',
        'This address is not yet assigned to a delivery zone.',
      );
    }

    const assignments = await c.env.prisma.slotZoneAssignment.findMany({
      where: {
        deliveryZoneId: address.deliveryZoneId,
        isActive: true,
        slot: { businessId: c.env.businessId, isActive: true, deletedAt: null },
      },
      include: { slot: true },
      orderBy: { slot: { displayOrder: 'asc' } },
    });

    return c.json({
      data: assignments.map((a) => ({
        id: a.slot.id,
        name: a.slot.name,
        start_time: formatTime(a.slot.startTime),
        end_time: formatTime(a.slot.endTime),
      })),
    });
  });

  return app;
}
