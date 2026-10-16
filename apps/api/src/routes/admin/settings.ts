import {
  adminUnitListResponseSchema,
  adminUnitSchema,
  catalogueSettingsSchema,
  createUnitBodySchema,
  errorResponseSchema,
  listUnitsQuerySchema,
  updateCatalogueSettingsBodySchema,
  updateUnitBodySchema,
} from '@healthy-aahar/contracts';
import { businessScope } from '@healthy-aahar/core';
import { Hono } from 'hono';

import { registerRoute } from '../../lib/route-registry.js';
import type { AppBindings } from '../../types.js';

const jsonError = (description: string) => ({ description, schema: errorResponseSchema });

/**
 * Stage F — Global Settings: database-backed units and the configurable
 * catalogue tax-rate ceiling. `settings:read`/`settings:update` already
 * existed in the permission catalogue (granted to Super Admin and Admin)
 * but were unused by any route until this one.
 */

function toUnitView(unit: {
  id: string;
  code: string;
  label: string;
  symbol: string;
  dimension: string;
  isActive: boolean;
}) {
  return {
    id: unit.id,
    code: unit.code,
    label: unit.label,
    symbol: unit.symbol,
    dimension: unit.dimension,
    is_active: unit.isActive,
  };
}

registerRoute({
  method: 'GET',
  path: '/v1/admin/settings/units',
  audience: 'admin',
  permission: 'settings:read',
  summary: 'List units of measurement',
  phase: 'stage-f',
  openapi: {
    tags: ['Admin: Settings'],
    request: { query: listUnitsQuerySchema },
    responses: { 200: { description: 'Units', schema: adminUnitListResponseSchema } },
  },
});

registerRoute({
  method: 'POST',
  path: '/v1/admin/settings/units',
  audience: 'admin',
  permission: 'settings:update',
  summary: 'Create a unit of measurement',
  phase: 'stage-f',
  errors: ['UNIT_CODE_TAKEN'],
  openapi: {
    tags: ['Admin: Settings'],
    request: { body: createUnitBodySchema },
    responses: {
      201: { description: 'Unit', schema: adminUnitSchema },
      409: jsonError('A unit with this code already exists'),
    },
  },
});

registerRoute({
  method: 'PATCH',
  path: '/v1/admin/settings/units/{id}',
  audience: 'admin',
  permission: 'settings:update',
  summary: 'Edit a unit (label, symbol, active status)',
  phase: 'stage-f',
  errors: ['UNIT_NOT_FOUND', 'UNIT_IN_USE'],
  openapi: {
    tags: ['Admin: Settings'],
    request: { body: updateUnitBodySchema },
    responses: {
      200: { description: 'Unit', schema: adminUnitSchema },
      404: jsonError('Unit not found'),
      409: jsonError('Unit is referenced by existing product variants'),
    },
  },
});

registerRoute({
  method: 'GET',
  path: '/v1/admin/settings/catalogue',
  audience: 'admin',
  permission: 'settings:read',
  summary: 'Get catalogue settings (tax-rate ceiling)',
  phase: 'stage-f',
  openapi: {
    tags: ['Admin: Settings'],
    responses: { 200: { description: 'Catalogue settings', schema: catalogueSettingsSchema } },
  },
});

registerRoute({
  method: 'PATCH',
  path: '/v1/admin/settings/catalogue',
  audience: 'admin',
  permission: 'settings:update',
  summary: 'Update catalogue settings (tax-rate ceiling)',
  phase: 'stage-f',
  errors: ['VALIDATION_FAILED'],
  openapi: {
    tags: ['Admin: Settings'],
    request: { body: updateCatalogueSettingsBodySchema },
    responses: { 200: { description: 'Catalogue settings', schema: catalogueSettingsSchema } },
  },
});

export function adminSettingsRoutes(): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.get('/settings/units', async (c) => {
    const query = listUnitsQuerySchema.parse({ active_only: c.req.query('active_only') });
    const units = await c.env.services.adminSettings.listUnits(businessScope(c.env.businessId), {
      activeOnly: query.active_only,
    });
    return c.json({ data: units.map(toUnitView) });
  });

  app.post('/settings/units', async (c) => {
    const body = createUnitBodySchema.parse(await c.req.json());
    const actor = c.get('actor');
    if (actor.kind !== 'ADMIN') throw new Error('unreachable: adminAuth guarantees ADMIN');

    const unit = await c.env.services.adminSettings.createUnit(
      businessScope(c.env.businessId),
      body,
      actor.userId,
    );
    return c.json(toUnitView(unit), 201);
  });

  app.patch('/settings/units/:id', async (c) => {
    const body = updateUnitBodySchema.parse(await c.req.json());
    const actor = c.get('actor');
    if (actor.kind !== 'ADMIN') throw new Error('unreachable: adminAuth guarantees ADMIN');

    const unit = await c.env.services.adminSettings.updateUnit(
      businessScope(c.env.businessId),
      c.req.param('id'),
      {
        ...(body.label !== undefined ? { label: body.label } : {}),
        ...(body.symbol !== undefined ? { symbol: body.symbol } : {}),
        ...(body.is_active !== undefined ? { isActive: body.is_active } : {}),
      },
      actor.userId,
    );
    return c.json(toUnitView(unit));
  });

  app.get('/settings/catalogue', async (c) => {
    const maxTaxRateBps = await c.env.services.adminSettings.getMaxTaxRateBps(
      businessScope(c.env.businessId),
    );
    return c.json({ max_tax_rate_bps: maxTaxRateBps });
  });

  app.patch('/settings/catalogue', async (c) => {
    const body = updateCatalogueSettingsBodySchema.parse(await c.req.json());
    const actor = c.get('actor');
    if (actor.kind !== 'ADMIN') throw new Error('unreachable: adminAuth guarantees ADMIN');

    const maxTaxRateBps = await c.env.services.adminSettings.setMaxTaxRateBps(
      businessScope(c.env.businessId),
      body.max_tax_rate_bps,
      actor.userId,
    );
    return c.json({ max_tax_rate_bps: maxTaxRateBps });
  });

  return app;
}
