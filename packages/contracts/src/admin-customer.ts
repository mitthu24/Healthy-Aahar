import { z } from 'zod';

import { adminOrderSchema } from './admin-order.js';
import { moneySchema, uuidSchema } from './common.js';

/**
 * Founder customer directory (Stage E). `email`/`phone` are ALWAYS masked
 * here — `customers:read` never returns real contact details; only the
 * separate `POST /customers/{id}/reveal-pii` action (gated on
 * `customers:read_pii`, audited on every call) does. See
 * `CustomerAdminService`'s doc comment for the full policy.
 */

export const customerAccountStatusSchema = z.enum(['ACTIVE', 'SUSPENDED', 'DEACTIVATED']);

export const adminCustomerSchema = z.object({
  id: uuidSchema,
  user_id: uuidSchema,
  full_name: z.string().nullable(),
  /** Masked, e.g. "j*****e@example.com" — see module doc comment. */
  email: z.string().nullable(),
  /** Masked, e.g. "+********3210" — see module doc comment. */
  phone: z.string().nullable(),
  status: customerAccountStatusSchema,
  marketing_opt_in: z.boolean(),
  created_at: z.string(),
  /** Computed live from non-cancelled orders — never the (unmaintained) CustomerProfile counters. */
  total_orders: z.number().int(),
  lifetime_value: moneySchema,
  last_order_at: z.string().nullable(),
});
export type AdminCustomer = z.infer<typeof adminCustomerSchema>;

export const adminCustomerListResponseSchema = z.object({
  data: z.array(adminCustomerSchema),
  pagination: z.object({
    limit: z.number(),
    next_cursor: z.string().nullable(),
    has_more: z.boolean(),
  }),
});
export type AdminCustomerListResponse = z.infer<typeof adminCustomerListResponseSchema>;

export const listAdminCustomersQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: customerAccountStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export const adminCustomerDetailSchema = adminCustomerSchema.extend({
  recent_orders: z.array(
    adminOrderSchema.pick({
      id: true,
      order_number: true,
      status: true,
      payment_method: true,
      payment_status: true,
      customer_name: true,
      total: true,
      service_date: true,
      placed_at: true,
    }),
  ),
});
export type AdminCustomerDetail = z.infer<typeof adminCustomerDetailSchema>;

export const revealCustomerPiiResponseSchema = z.object({
  id: uuidSchema,
  email: z.string().nullable(),
  phone: z.string().nullable(),
});
export type RevealCustomerPiiResponse = z.infer<typeof revealCustomerPiiResponseSchema>;
