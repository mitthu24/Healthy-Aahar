import { z } from 'zod';

import { moneySchema, uuidSchema } from './common.js';

/**
 * Customer-facing delivery slots (Phase 04 — delivery-slot-only checkout,
 * no zone management; see docs/PHASE-04-STOREFRONT-IMPLEMENTATION-REPORT.md
 * §15). Scoped to the business, not to an address/zone — any address the
 * customer owns can be delivered in any active slot that has room.
 */
export const deliverySlotSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  start_time: z.string(),
  end_time: z.string(),
  delivery_fee: moneySchema,
  /** Only meaningful when the request included `service_date`; null otherwise. */
  remaining_capacity: z.number().int().nullable(),
  is_available: z.boolean(),
});
export type DeliverySlotDto = z.infer<typeof deliverySlotSchema>;

export const deliverySlotListResponseSchema = z.object({ data: z.array(deliverySlotSchema) });
export type DeliverySlotListResponse = z.infer<typeof deliverySlotListResponseSchema>;

// ── Admin delivery-slot management (Phase 04) ───────────────────────────

export const adminDeliverySlotSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  code: z.string(),
  start_time: z.string(),
  end_time: z.string(),
  cutoff_time: z.string(),
  cutoff_days_before: z.number().int(),
  available_days: z.array(z.number().int().min(1).max(7)),
  default_capacity: z.number().int(),
  delivery_fee: moneySchema.nullable(),
  min_order_value: moneySchema.nullable(),
  is_active: z.boolean(),
  display_order: z.number().int(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type AdminDeliverySlotDto = z.infer<typeof adminDeliverySlotSchema>;

export const adminDeliverySlotListResponseSchema = z.object({
  data: z.array(adminDeliverySlotSchema),
});
export type AdminDeliverySlotListResponse = z.infer<typeof adminDeliverySlotListResponseSchema>;

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Must be HH:MM, 24-hour');

export const createDeliverySlotBodySchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    code: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Code must be lowercase, hyphen-separated'),
    start_time: hhmm,
    end_time: hhmm,
    cutoff_time: hhmm.optional(),
    cutoff_days_before: z.number().int().min(0).max(7).default(0),
    available_days: z.array(z.number().int().min(1).max(7)).min(1).max(7),
    default_capacity: z.number().int().positive(),
    delivery_fee_paise: z.number().int().min(0).optional(),
    min_order_value_paise: z.number().int().min(0).optional(),
    display_order: z.number().int().min(0).default(0),
  })
  .refine((body) => body.start_time < body.end_time, {
    message: 'start_time must be before end_time',
    path: ['end_time'],
  });
export type CreateDeliverySlotBody = z.infer<typeof createDeliverySlotBodySchema>;

export const updateDeliverySlotBodySchema = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    start_time: hhmm.optional(),
    end_time: hhmm.optional(),
    cutoff_time: hhmm.optional(),
    cutoff_days_before: z.number().int().min(0).max(7).optional(),
    available_days: z.array(z.number().int().min(1).max(7)).min(1).max(7).optional(),
    default_capacity: z.number().int().positive().optional(),
    delivery_fee_paise: z.number().int().min(0).nullable().optional(),
    min_order_value_paise: z.number().int().min(0).nullable().optional(),
    display_order: z.number().int().min(0).optional(),
    is_active: z.boolean().optional(),
  })
  .refine((body) => !(body.start_time && body.end_time) || body.start_time < body.end_time, {
    message: 'start_time must be before end_time',
    path: ['end_time'],
  });
export type UpdateDeliverySlotBody = z.infer<typeof updateDeliverySlotBodySchema>;
