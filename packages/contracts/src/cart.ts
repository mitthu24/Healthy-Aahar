import { z } from 'zod';

import { moneySchema, uuidSchema } from './common.js';

/**
 * Cart (docs/14 §3.4, docs/19 "the trap being avoided").
 *
 * The cart NEVER stores a total — every response recomputes line and cart
 * totals from the live `ProductVariant.price_paise` at read time, which is
 * also why `issues` exists: a cart can go stale (price changed, item went
 * out of stock) between visits, and the client is told in the same response
 * instead of discovering it for the first time at checkout.
 */

export const cartIssueSchema = z.object({
  item_id: uuidSchema,
  code: z.enum(['PRICE_CHANGED', 'OUT_OF_STOCK', 'MAX_QUANTITY_EXCEEDED', 'ITEM_UNAVAILABLE']),
  message: z.string(),
});
export type CartIssueDto = z.infer<typeof cartIssueSchema>;

export const cartItemSchema = z.object({
  id: uuidSchema,
  variant_id: uuidSchema,
  product_id: uuidSchema,
  product_name: z.string(),
  variant_name: z.string(),
  image_url: z.string().nullable(),
  unit_price: moneySchema,
  quantity: z.number().int(),
  line_total: moneySchema,
});
export type CartItemDto = z.infer<typeof cartItemSchema>;

export const cartSchema = z.object({
  id: uuidSchema,
  items: z.array(cartItemSchema),
  subtotal: moneySchema,
  issues: z.array(cartIssueSchema),
  item_count: z.number().int(),
});
export type CartDto = z.infer<typeof cartSchema>;

export const addCartItemBodySchema = z.object({
  variant_id: uuidSchema,
  quantity: z.number().int().min(1).max(99),
});
export type AddCartItemBody = z.infer<typeof addCartItemBodySchema>;

export const updateCartItemBodySchema = z.object({
  quantity: z.number().int().min(1).max(99),
});
export type UpdateCartItemBody = z.infer<typeof updateCartItemBodySchema>;
