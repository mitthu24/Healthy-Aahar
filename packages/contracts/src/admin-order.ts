import { z } from 'zod';

import { moneySchema, paginatedSchema, uuidSchema } from './common.js';
import { dashboardDateRangeQuerySchema, orderStatusCountSchema } from './dashboard.js';
import { orderAddressSnapshotSchema, orderItemSchema, orderStatusValueSchema } from './order.js';

/**
 * Admin order management (docs/15 §4.1; Phase 04 requirement change).
 *
 * Orders are auto-confirmed on checkout, so there is deliberately no "accept"
 * route here — admin manages FULFILMENT (prepare/dispatch/deliver), can
 * cancel/"reject" a confirmed order when delivery turns out infeasible
 * (reusing the existing CANCELLED transition with `cancelled_by_type=ADMIN`,
 * which the customer app renders as "Rejected" — no new order status), and
 * records COD collection separately from delivery status.
 */

export const adminOrderSchema = z.object({
  id: uuidSchema,
  order_number: z.string(),
  status: orderStatusValueSchema,
  payment_method: z.enum(['COD', 'ONLINE', 'WALLET', 'CREDIT']),
  payment_status: z.enum([
    'DUE',
    'AUTHORIZED',
    'PAID',
    'PARTIALLY_REFUNDED',
    'REFUNDED',
    'FAILED',
    'CANCELLED',
  ]),
  customer_name: z.string(),
  customer_phone: z.string(),
  items: z.array(orderItemSchema),
  total: moneySchema,
  delivery_address: orderAddressSnapshotSchema,
  service_date: z.string(),
  slot_name: z.string(),
  internal_note: z.string().nullable(),
  cancelled_by_type: z.enum(['CUSTOMER', 'ADMIN', 'SYSTEM']).nullable(),
  cancellation_reason: z.string().nullable(),
  placed_at: z.string(),
  updated_at: z.string(),
  assigned_partner_id: uuidSchema.nullable(),
  assigned_partner_name: z.string().nullable(),
  assigned_at: z.string().nullable(),
});
export type AdminOrderDto = z.infer<typeof adminOrderSchema>;

export const adminOrderListResponseSchema = paginatedSchema(
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
);
export type AdminOrderListResponse = z.infer<typeof adminOrderListResponseSchema>;

export const listAdminOrdersQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().optional(),
    status: orderStatusValueSchema.optional(),
    assigned_partner_id: uuidSchema.optional(),
    unassigned: z.coerce.boolean().optional(),
    // Business dates (Asia/Kolkata, YYYY-MM-DD) — both required together or
    // omitted together, same convention as the dashboard's date range.
    from: dashboardDateRangeQuerySchema.shape.from.optional(),
    to: dashboardDateRangeQuerySchema.shape.to.optional(),
  })
  .refine((v) => (v.from === undefined) === (v.to === undefined), {
    message: 'from and to must be given together.',
    path: ['from'],
  });

/**
 * Per-status order counts for the Orders dashboard's tabs — same date-range
 * convention as `listAdminOrdersQuerySchema`'s `from`/`to`, so the list and
 * the counts always agree on which orders are "in range."
 */
export const adminOrderCountsQuerySchema = dashboardDateRangeQuerySchema;

export const adminOrderCountsResponseSchema = z.object({
  total: z.number().int(),
  by_status: z.array(orderStatusCountSchema),
});
export type AdminOrderCountsResponse = z.infer<typeof adminOrderCountsResponseSchema>;

export const updateOrderStatusBodySchema = z.object({
  to_status: orderStatusValueSchema,
  reason: z.string().trim().max(500).optional(),
});
export type UpdateOrderStatusBody = z.infer<typeof updateOrderStatusBodySchema>;

export const rejectOrderBodySchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type RejectOrderBody = z.infer<typeof rejectOrderBodySchema>;

export const holdOrderBodySchema = z.object({
  note: z.string().trim().min(1).max(500),
});
export type HoldOrderBody = z.infer<typeof holdOrderBodySchema>;

export const recordCodCollectionBodySchema = z.object({
  amount_paise: z.number().int().positive(),
});
export type RecordCodCollectionBody = z.infer<typeof recordCodCollectionBodySchema>;
