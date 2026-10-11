import { deliverySlotListResponseSchema } from '@healthy-aahar/contracts';
import { money } from '@healthy-aahar/core';
import { Hono } from 'hono';

import { registerRoute } from '../../lib/route-registry.js';
import type { AppBindings } from '../../types.js';

/**
 * Delivery slots, scoped to the business (Phase 04 — delivery-slot-only
 * checkout; see docs/PHASE-04-STOREFRONT-IMPLEMENTATION-REPORT.md §15 for
 * why there is no zone here). Independent of the customer's address —
 * never an allowlist gate.
 */
registerRoute({
  method: 'GET',
  path: '/v1/me/delivery-slots',
  audience: 'customer',
  summary: 'List active delivery slots, optionally with remaining capacity for a date',
  phase: '04',
  openapi: {
    description:
      'With `service_date`, each slot not offered that day is excluded and ' +
      'the rest carry a live `remaining_capacity`. Without it, every active ' +
      'slot is returned with `remaining_capacity: null`.',
    tags: ['Orders'],
    responses: { 200: { description: 'Delivery slots', schema: deliverySlotListResponseSchema } },
  },
});

function formatTime(date: Date): string {
  return date.toISOString().slice(11, 16);
}

function isoWeekdayOf(date: Date): number {
  return ((date.getUTCDay() + 6) % 7) + 1; // JS 0=Sun -> ISO 1=Mon..7=Sun
}

export function deliverySlotsRoutes(): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.get('/', async (c) => {
    const serviceDateParam = c.req.query('service_date');
    const serviceDate = serviceDateParam ? new Date(serviceDateParam) : null;

    const slots = await c.env.prisma.deliverySlot.findMany({
      where: { businessId: c.env.businessId, isActive: true, deletedAt: null },
      orderBy: { displayOrder: 'asc' },
    });

    const visible = serviceDate
      ? slots.filter((slot) => slot.availableDays.includes(isoWeekdayOf(serviceDate)))
      : slots;

    const data = await Promise.all(
      visible.map(async (slot) => {
        let remaining: number | null = null;
        if (serviceDate) {
          const bookedCount = await c.env.prisma.order.count({
            where: {
              deliverySlotId: slot.id,
              serviceDate,
              status: { notIn: ['CANCELLED', 'FAILED'] },
            },
          });
          remaining = Math.max(slot.defaultCapacity - bookedCount, 0);
        }

        return {
          id: slot.id,
          name: slot.name,
          start_time: formatTime(slot.startTime),
          end_time: formatTime(slot.endTime),
          delivery_fee: money(Number(slot.deliveryFeePaise ?? 0n)),
          remaining_capacity: remaining,
          is_available: remaining === null || remaining > 0,
        };
      }),
    );

    return c.json({ data });
  });

  return app;
}
