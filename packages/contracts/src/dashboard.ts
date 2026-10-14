import { z } from 'zod';

import { moneySchema, uuidSchema } from './common.js';

/**
 * Founder analytics (Stage D). `from`/`to` are business dates
 * (`Asia/Kolkata`, `YYYY-MM-DD`) — the server resolves the exact UTC
 * instants, same convention as `service_date` elsewhere (packages/
 * contracts/src/order.ts).
 */
const businessDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD');

export const dashboardDateRangeQuerySchema = z.object({
  from: businessDateSchema,
  to: businessDateSchema,
});

export const orderStatusCountSchema = z.object({
  status: z.string(),
  count: z.number().int(),
});

export const dashboardSummarySchema = z.object({
  order_count: z.number().int(),
  gross_sales: moneySchema,
  discounts: moneySchema,
  cancelled_count: z.number().int(),
  cancelled_value: moneySchema,
  net_sales: moneySchema,
  average_order_value: moneySchema.nullable(),
  collected: moneySchema,
  refunded: moneySchema,
  outstanding_cod: moneySchema,
  status_breakdown: z.array(orderStatusCountSchema),
  delivery: z.object({
    delivered_count: z.number().int(),
    failed_count: z.number().int(),
    avg_fulfilment_minutes: z.number().nullable(),
    on_time_rate: z.number().min(0).max(1).nullable(),
  }),
  new_customers_count: z.number().int(),
});
export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;

export const salesTrendPointSchema = z.object({
  date: z.string(),
  order_count: z.number().int(),
  gross_sales: moneySchema,
});
export const salesTrendResponseSchema = z.object({ data: z.array(salesTrendPointSchema) });
export type SalesTrendResponse = z.infer<typeof salesTrendResponseSchema>;

export const topProductsQuerySchema = dashboardDateRangeQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export const topProductSchema = z.object({
  variant_id: uuidSchema,
  product_name: z.string(),
  quantity: z.number().int(),
  revenue: moneySchema,
});
export const topProductsResponseSchema = z.object({ data: z.array(topProductSchema) });
export type TopProductsResponse = z.infer<typeof topProductsResponseSchema>;

export const inventoryAlertsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const inventoryAlertSchema = z.object({
  variant_id: uuidSchema,
  product_name: z.string(),
  quantity_on_hand: z.number().int(),
  quantity_reserved: z.number().int(),
  quantity_available: z.number().int(),
  low_stock_threshold: z.number().int(),
});
export const inventoryAlertsResponseSchema = z.object({ data: z.array(inventoryAlertSchema) });
export type InventoryAlertsResponse = z.infer<typeof inventoryAlertsResponseSchema>;
