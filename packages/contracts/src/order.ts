import { z } from 'zod';

import { moneySchema, paginatedSchema, uuidSchema } from './common.js';

/**
 * Checkout and customer-facing orders (docs/09, docs/19, docs/14 §3.5-3.8).
 *
 * `POST /v1/me/orders` is the one write that matters here: it recomputes
 * every price and stock check from the database, creates the order and its
 * payment row, reserves inventory, and — per the Phase 04 requirement
 * change — auto-confirms the order (PENDING -> CONFIRMED via the existing
 * SYSTEM-actor transition) inside the same atomic transaction. Nothing a
 * client sends is trusted for price or availability.
 */

export const orderStatusValueSchema = z.enum([
  'PENDING',
  'CONFIRMED',
  'PREPARING',
  'READY_FOR_DISPATCH',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'CANCELLED',
  'FAILED',
  'RETURNED',
]);

export const orderItemSchema = z.object({
  id: uuidSchema,
  product_name: z.string(),
  variant_name: z.string().nullable(),
  image_url: z.string().nullable(),
  quantity: z.number().int(),
  unit_price: moneySchema,
  line_total: moneySchema,
});
export type OrderItemDto = z.infer<typeof orderItemSchema>;

export const orderAddressSnapshotSchema = z.object({
  recipient_name: z.string(),
  recipient_phone: z.string(),
  line1: z.string(),
  line2: z.string().nullable(),
  landmark: z.string().nullable(),
  city: z.string(),
  state: z.string(),
  pincode: z.string(),
});

export const orderSchema = z.object({
  id: uuidSchema,
  order_number: z.string(),
  status: orderStatusValueSchema,
  display_status: z.string(),
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
  items: z.array(orderItemSchema),
  subtotal: moneySchema,
  delivery_fee: moneySchema,
  discount: moneySchema,
  tax: moneySchema,
  total: moneySchema,
  delivery_address: orderAddressSnapshotSchema,
  service_date: z.string(),
  slot_name: z.string(),
  customer_note: z.string().nullable(),
  cancellation_reason: z.string().nullable(),
  placed_at: z.string(),
  confirmed_at: z.string().nullable(),
  status_history: z.array(
    z.object({ status: orderStatusValueSchema, display_status: z.string(), at: z.string() }),
  ),
});
export type OrderDto = z.infer<typeof orderSchema>;

export const orderListResponseSchema = paginatedSchema(
  orderSchema
    .pick({
      id: true,
      order_number: true,
      status: true,
      display_status: true,
      total: true,
      placed_at: true,
    })
    .extend({ item_count: z.number().int() }),
);
export type OrderListResponse = z.infer<typeof orderListResponseSchema>;

export const checkoutBodySchema = z.object({
  address_id: uuidSchema,
  delivery_slot_id: uuidSchema,
  service_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'service_date must be YYYY-MM-DD'),
  customer_note: z.string().trim().max(500).optional(),
});
export type CheckoutBody = z.infer<typeof checkoutBodySchema>;
