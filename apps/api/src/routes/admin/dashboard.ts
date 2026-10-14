import {
  dashboardDateRangeQuerySchema,
  dashboardSummarySchema,
  errorResponseSchema,
  inventoryAlertsQuerySchema,
  inventoryAlertsResponseSchema,
  salesTrendResponseSchema,
  topProductsQuerySchema,
  topProductsResponseSchema,
} from '@healthy-aahar/contracts';
import { businessScope } from '@healthy-aahar/core';
import { Hono } from 'hono';

import { registerRoute } from '../../lib/route-registry.js';
import type { AppBindings } from '../../types.js';

const jsonError = (description: string) => ({ description, schema: errorResponseSchema });

/**
 * Founder analytics (Stage D, docs TBD). Every figure here is computed
 * fresh from `orders`/`payments`/`order_items`/`inventory` — nothing is
 * hardcoded or estimated, and an empty range returns real zeros/nulls,
 * never a fabricated placeholder (see `DashboardService`'s doc comment
 * for the exact definition of each metric).
 *
 * Gated by `dashboard:read` — the same permission the (honest, numberless)
 * admin home page has always declared it would need once this existed.
 * "Recent orders" deliberately has no endpoint here: `GET /v1/admin/orders
 * ?limit=N` already does exactly that, sorted by `placed_at DESC` — adding
 * a second route for the same read would be the duplicate implementation
 * Stage D's own instructions say not to create.
 */

registerRoute({
  method: 'GET',
  path: '/v1/admin/dashboard/summary',
  audience: 'admin',
  permission: 'dashboard:read',
  summary: 'KPI summary, order-status breakdown and delivery performance for a date range',
  phase: 'stage-d',
  errors: ['VALIDATION_FAILED'],
  openapi: {
    tags: ['Admin: Dashboard'],
    request: { query: dashboardDateRangeQuerySchema },
    responses: {
      200: { description: 'Summary', schema: dashboardSummarySchema },
      422: jsonError('from/to invalid, out of order, or span too wide'),
    },
  },
});

registerRoute({
  method: 'GET',
  path: '/v1/admin/dashboard/sales-trend',
  audience: 'admin',
  permission: 'dashboard:read',
  summary: 'Daily order count and gross sales for a date range',
  phase: 'stage-d',
  errors: ['VALIDATION_FAILED'],
  openapi: {
    tags: ['Admin: Dashboard'],
    request: { query: dashboardDateRangeQuerySchema },
    responses: {
      200: { description: 'Trend points', schema: salesTrendResponseSchema },
      422: jsonError('from/to invalid, out of order, or span too wide'),
    },
  },
});

registerRoute({
  method: 'GET',
  path: '/v1/admin/dashboard/top-products',
  audience: 'admin',
  permission: 'dashboard:read',
  summary: 'Best-selling products by revenue for a date range',
  phase: 'stage-d',
  errors: ['VALIDATION_FAILED'],
  openapi: {
    tags: ['Admin: Dashboard'],
    request: { query: topProductsQuerySchema },
    responses: {
      200: { description: 'Top products', schema: topProductsResponseSchema },
      422: jsonError('from/to invalid, out of order, or span too wide'),
    },
  },
});

registerRoute({
  method: 'GET',
  path: '/v1/admin/dashboard/inventory-alerts',
  audience: 'admin',
  permission: 'dashboard:read',
  summary: 'Variants at or below their low-stock threshold (current snapshot, not date-ranged)',
  phase: 'stage-d',
  openapi: {
    tags: ['Admin: Dashboard'],
    request: { query: inventoryAlertsQuerySchema },
    responses: {
      200: { description: 'Low-stock variants', schema: inventoryAlertsResponseSchema },
    },
  },
});

export function dashboardRoutes(): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.get('/summary', async (c) => {
    const query = dashboardDateRangeQuerySchema.parse(c.req.query());
    const scope = businessScope(c.env.businessId);
    const summary = await c.env.services.dashboard.getSummary(scope, query);
    return c.json(summary);
  });

  app.get('/sales-trend', async (c) => {
    const query = dashboardDateRangeQuerySchema.parse(c.req.query());
    const scope = businessScope(c.env.businessId);
    const data = await c.env.services.dashboard.getSalesTrend(scope, query);
    return c.json({ data });
  });

  app.get('/top-products', async (c) => {
    const query = topProductsQuerySchema.parse(c.req.query());
    const scope = businessScope(c.env.businessId);
    const data = await c.env.services.dashboard.getTopProducts(scope, query, query.limit);
    return c.json({ data });
  });

  app.get('/inventory-alerts', async (c) => {
    const query = inventoryAlertsQuerySchema.parse(c.req.query());
    const scope = businessScope(c.env.businessId);
    const data = await c.env.services.dashboard.getInventoryAlerts(scope, query.limit);
    return c.json({ data });
  });

  return app;
}
