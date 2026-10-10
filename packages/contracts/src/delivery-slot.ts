import { z } from 'zod';

import { uuidSchema } from './common.js';

/**
 * Customer-facing delivery slots for an address's zone (Phase 04).
 *
 * Deliberately minimal: PHASE 06 is where slot capacity, cutoffs and
 * per-day availability become a full booking system. This exposes just
 * enough — the slots a checkout screen can offer for a given address — for
 * the first complete customer journey, without inventing capacity logic
 * this phase does not own.
 */
export const deliverySlotSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  start_time: z.string(),
  end_time: z.string(),
});
export type DeliverySlotDto = z.infer<typeof deliverySlotSchema>;

export const deliverySlotListResponseSchema = z.object({ data: z.array(deliverySlotSchema) });
export type DeliverySlotListResponse = z.infer<typeof deliverySlotListResponseSchema>;
