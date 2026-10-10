import { z } from 'zod';

import { paginatedSchema, phoneSchema, pincodeSchema, uuidSchema } from './common.js';

/**
 * Customer delivery addresses (docs/14 §3.10, docs/04 §Address).
 *
 * `is_serviceable` is derived server-side from whether the address resolved
 * to a delivery zone — never a client-supplied flag (same discipline as
 * serviceability, docs/23 §4). An address can be saved even when it does not
 * resolve to a zone today; it simply cannot be used for checkout yet.
 */

export const addressSchema = z.object({
  id: uuidSchema,
  label: z.string().nullable(),
  recipient_name: z.string(),
  recipient_phone: z.string(),
  line1: z.string(),
  line2: z.string().nullable(),
  landmark: z.string().nullable(),
  city: z.string(),
  state: z.string(),
  pincode: z.string(),
  country: z.string(),
  delivery_instructions: z.string().nullable(),
  is_default: z.boolean(),
  is_serviceable: z.boolean(),
  delivery_zone_id: uuidSchema.nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type AddressDto = z.infer<typeof addressSchema>;

export const createAddressBodySchema = z.object({
  label: z.string().trim().max(40).optional(),
  recipient_name: z.string().trim().min(1).max(120),
  recipient_phone: phoneSchema,
  line1: z.string().trim().min(1).max(200),
  line2: z.string().trim().max(200).optional(),
  landmark: z.string().trim().max(200).optional(),
  city: z.string().trim().min(1).max(100),
  state: z.string().trim().min(1).max(100),
  pincode: pincodeSchema,
  delivery_instructions: z.string().trim().max(500).optional(),
  is_default: z.boolean().optional(),
});
export type CreateAddressBody = z.infer<typeof createAddressBodySchema>;

export const updateAddressBodySchema = createAddressBodySchema.partial();
export type UpdateAddressBody = z.infer<typeof updateAddressBodySchema>;

export const addressListResponseSchema = paginatedSchema(addressSchema);
export type AddressListResponse = z.infer<typeof addressListResponseSchema>;
