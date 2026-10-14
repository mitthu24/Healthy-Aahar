import {
  adminCustomerDetailSchema,
  adminCustomerListResponseSchema,
  errorResponseSchema,
  idParamSchema,
  listAdminCustomersQuerySchema,
  revealCustomerPiiResponseSchema,
} from '@healthy-aahar/contracts';
import { businessScope, DomainError } from '@healthy-aahar/core';
import { Hono } from 'hono';

import { toCsv } from '../../lib/csv.js';
import { registerRoute } from '../../lib/route-registry.js';
import type { AppBindings } from '../../types.js';

const jsonError = (description: string) => ({ description, schema: errorResponseSchema });

/**
 * Founder customer directory (Stage E, docs TBD). `customers:read` gates
 * every route here, including the CSV export — list/detail/export all
 * return masked contact fields. `customers:read_pii` gates ONLY the
 * `reveal-pii` action, which is separately permissioned and audited (see
 * `CustomerAdminService`'s doc comment).
 */

registerRoute({
  method: 'GET',
  path: '/v1/admin/customers',
  audience: 'admin',
  permission: 'customers:read',
  summary: 'List customers (masked contact fields), searchable and filterable',
  phase: 'stage-e',
  openapi: {
    tags: ['Admin: Customers'],
    request: { query: listAdminCustomersQuerySchema },
    responses: { 200: { description: 'Customers', schema: adminCustomerListResponseSchema } },
  },
});

registerRoute({
  method: 'GET',
  path: '/v1/admin/customers/export.csv',
  audience: 'admin',
  permission: 'customers:read',
  summary: 'Export the (masked) customer directory as CSV',
  phase: 'stage-e',
  openapi: {
    tags: ['Admin: Customers'],
    request: { query: listAdminCustomersQuerySchema.omit({ limit: true, cursor: true }) },
    responses: { 200: { description: 'CSV file' } },
  },
});

registerRoute({
  method: 'GET',
  path: '/v1/admin/customers/{id}',
  audience: 'admin',
  permission: 'customers:read',
  summary: 'Get a customer (masked contact fields) with recent order history',
  phase: 'stage-e',
  errors: ['NOT_FOUND'],
  openapi: {
    tags: ['Admin: Customers'],
    request: { params: idParamSchema },
    responses: {
      200: { description: 'Customer', schema: adminCustomerDetailSchema },
      404: jsonError('Not found'),
    },
  },
});

registerRoute({
  method: 'POST',
  path: '/v1/admin/customers/{id}/reveal-pii',
  audience: 'admin',
  permission: 'customers:read_pii',
  summary: "Reveal a customer's real email/phone — audited on every call",
  phase: 'stage-e',
  errors: ['NOT_FOUND'],
  openapi: {
    tags: ['Admin: Customers'],
    request: { params: idParamSchema },
    responses: {
      200: { description: 'Unmasked contact details', schema: revealCustomerPiiResponseSchema },
      404: jsonError('Not found'),
    },
  },
});

export function adminCustomersRoutes(): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.get('/', async (c) => {
    const query = listAdminCustomersQuerySchema.parse(c.req.query());
    const scope = businessScope(c.env.businessId);
    const result = await c.env.services.customers.list(
      scope,
      { q: query.q, status: query.status },
      { limit: query.limit, cursor: query.cursor },
    );
    return c.json(result);
  });

  app.get('/export.csv', async (c) => {
    const query = listAdminCustomersQuerySchema.omit({ limit: true, cursor: true }).parse(
      c.req.query(),
    );
    const scope = businessScope(c.env.businessId);
    const rows = await c.env.services.customers.listForExport(scope, {
      q: query.q,
      status: query.status,
    });

    const csv = toCsv(
      [
        'id',
        'full_name',
        'email_masked',
        'phone_masked',
        'status',
        'total_orders',
        'lifetime_value_paise',
        'last_order_at',
        'created_at',
      ],
      rows.map((r) => [
        r.id,
        r.full_name,
        r.email,
        r.phone,
        r.status,
        r.total_orders,
        r.lifetime_value.amount_paise,
        r.last_order_at,
        r.created_at,
      ]),
    );

    c.header('Content-Type', 'text/csv; charset=utf-8');
    c.header('Content-Disposition', 'attachment; filename="customers.csv"');
    return c.body(csv);
  });

  app.get('/:id', async (c) => {
    const params = idParamSchema.parse({ id: c.req.param('id') });
    const scope = businessScope(c.env.businessId);
    const result = await c.env.services.customers.get(scope, params.id);
    return c.json(result);
  });

  app.post('/:id/reveal-pii', async (c) => {
    const params = idParamSchema.parse({ id: c.req.param('id') });
    const actor = c.get('actor');
    if (actor.kind !== 'ADMIN') throw new DomainError('UNAUTHENTICATED', 'Not authenticated.');

    const scope = businessScope(c.env.businessId);
    const result = await c.env.services.customers.revealPii(scope, params.id, actor.userId);
    return c.json(result);
  });

  return app;
}
