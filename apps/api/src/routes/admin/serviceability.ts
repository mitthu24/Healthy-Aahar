import {
  cityAdminSchema,
  cityListResponseSchema,
  createCityBodySchema,
  createPincodeBodySchema,
  deactivateBodySchema,
  errorResponseSchema,
  idParamSchema,
  listCitiesQuerySchema,
  listPincodesQuerySchema,
  pincodeAdminSchema,
  pincodeListResponseSchema,
  updateCityBodySchema,
  updatePincodeBodySchema,
} from '@healthy-aahar/contracts';
import { businessScope, type CityRow, type PincodeRow } from '@healthy-aahar/core';
import { Hono } from 'hono';

import { registerRoute } from '../../lib/route-registry.js';
import type { AppBindings } from '../../types.js';

/**
 * Admin serviceability configuration (docs/06 §11.7a).
 *
 * This is the surface that makes city/pincode serviceability admin-owned:
 * expansion from Noida to Greater Noida, Delhi or Gurgaon happens here, as
 * data, with no deploy (BR-SV1).
 *
 * Status is never accepted in a create or update body. Activation and
 * deactivation are separate endpoints because they are separate decisions
 * with separate consequences — deactivating a city stops revenue from an
 * entire market (BR-SV5).
 *
 * Authentication is the PHASE 02 development bypass (ADR-030); real RBAC
 * lands in PHASE 03. Each route declares the permission it WILL require, and
 * the registry asserts it at boot, so PHASE 03 wires enforcement without
 * having to discover the permission map.
 */

const jsonError = (description: string) => ({ description, schema: errorResponseSchema });

// ── Cities ────────────────────────────────────────────────────────────────

registerRoute({
  method: 'GET',
  path: '/v1/admin/cities',
  audience: 'admin',
  permission: 'delivery:read',
  summary: 'List cities',
  phase: '02',
  openapi: {
    tags: ['Admin: Cities'],
    request: { query: listCitiesQuerySchema },
    responses: {
      200: { description: 'Paginated cities', schema: cityListResponseSchema },
      401: jsonError('Not authenticated'),
    },
  },
});

registerRoute({
  method: 'POST',
  path: '/v1/admin/cities',
  audience: 'admin',
  permission: 'delivery:manage',
  summary: 'Create a city (always INACTIVE; activate separately)',
  phase: '02',
  openapi: {
    tags: ['Admin: Cities'],
    request: { body: createCityBodySchema },
    responses: {
      201: { description: 'City created', schema: cityAdminSchema },
      422: jsonError('Validation failed or slug already in use'),
    },
  },
});

registerRoute({
  method: 'GET',
  path: '/v1/admin/cities/{id}',
  audience: 'admin',
  permission: 'delivery:read',
  summary: 'Get a city',
  phase: '02',
  openapi: {
    tags: ['Admin: Cities'],
    request: { params: idParamSchema },
    responses: {
      200: { description: 'City', schema: cityAdminSchema },
      404: jsonError('Not found, or not in this business'),
    },
  },
});

registerRoute({
  method: 'PATCH',
  path: '/v1/admin/cities/{id}',
  audience: 'admin',
  permission: 'delivery:manage',
  summary: 'Update a city (status is not settable here)',
  phase: '02',
  openapi: {
    tags: ['Admin: Cities'],
    request: { params: idParamSchema, body: updateCityBodySchema },
    responses: {
      200: { description: 'City updated', schema: cityAdminSchema },
      404: jsonError('Not found'),
    },
  },
});

registerRoute({
  method: 'POST',
  path: '/v1/admin/cities/{id}/activate',
  audience: 'admin',
  permission: 'delivery:manage',
  summary: 'Activate a city (requires at least one ACTIVE pincode)',
  phase: '02',
  openapi: {
    tags: ['Admin: Cities'],
    request: { params: idParamSchema },
    responses: {
      200: { description: 'City activated', schema: cityAdminSchema },
      409: jsonError('City has no ACTIVE pincodes to serve'),
    },
  },
});

registerRoute({
  method: 'POST',
  path: '/v1/admin/cities/{id}/deactivate',
  audience: 'admin',
  permission: 'delivery:manage',
  summary: 'Deactivate a city (reason required; nothing is deleted)',
  phase: '02',
  openapi: {
    tags: ['Admin: Cities'],
    request: { params: idParamSchema, body: deactivateBodySchema },
    responses: {
      200: { description: 'City deactivated', schema: cityAdminSchema },
      422: jsonError('Reason missing'),
    },
  },
});

// ── Pincodes ──────────────────────────────────────────────────────────────

registerRoute({
  method: 'GET',
  path: '/v1/admin/service-pincodes',
  audience: 'admin',
  permission: 'delivery:read',
  summary: 'List service pincodes',
  phase: '02',
  openapi: {
    tags: ['Admin: Pincodes'],
    request: { query: listPincodesQuerySchema },
    responses: {
      200: { description: 'Paginated pincodes', schema: pincodeListResponseSchema },
    },
  },
});

registerRoute({
  method: 'POST',
  path: '/v1/admin/service-pincodes',
  audience: 'admin',
  permission: 'delivery:manage',
  summary: 'Create a service pincode (always INACTIVE)',
  phase: '02',
  openapi: {
    tags: ['Admin: Pincodes'],
    request: { body: createPincodeBodySchema },
    responses: {
      201: { description: 'Pincode created', schema: pincodeAdminSchema },
      409: jsonError('Pincode already assigned within this business'),
      422: jsonError('Invalid pincode format'),
    },
  },
});

registerRoute({
  method: 'GET',
  path: '/v1/admin/service-pincodes/{id}',
  audience: 'admin',
  permission: 'delivery:read',
  summary: 'Get a service pincode',
  phase: '02',
  openapi: {
    tags: ['Admin: Pincodes'],
    request: { params: idParamSchema },
    responses: {
      200: { description: 'Pincode', schema: pincodeAdminSchema },
      404: jsonError('Not found'),
    },
  },
});

registerRoute({
  method: 'PATCH',
  path: '/v1/admin/service-pincodes/{id}',
  audience: 'admin',
  permission: 'delivery:manage',
  summary: 'Update a service pincode',
  phase: '02',
  openapi: {
    tags: ['Admin: Pincodes'],
    request: { params: idParamSchema, body: updatePincodeBodySchema },
    responses: {
      200: { description: 'Pincode updated', schema: pincodeAdminSchema },
      404: jsonError('Not found'),
    },
  },
});

registerRoute({
  method: 'POST',
  path: '/v1/admin/service-pincodes/{id}/activate',
  audience: 'admin',
  permission: 'delivery:manage',
  summary: 'Activate a pincode',
  phase: '02',
  openapi: {
    description:
      'Always succeeds. If the parent city is not ACTIVE the pincode is ' +
      'activated but is NOT yet serviceable (the city gate runs first, ' +
      'BR-SV9) and a `warning` field explains why.',
    tags: ['Admin: Pincodes'],
    request: { params: idParamSchema },
    responses: {
      200: { description: 'Pincode activated', schema: pincodeAdminSchema },
      404: jsonError('Not found'),
    },
  },
});

registerRoute({
  method: 'POST',
  path: '/v1/admin/service-pincodes/{id}/deactivate',
  audience: 'admin',
  permission: 'delivery:manage',
  summary: 'Deactivate a pincode (reason required)',
  phase: '02',
  openapi: {
    tags: ['Admin: Pincodes'],
    request: { params: idParamSchema, body: deactivateBodySchema },
    responses: {
      200: { description: 'Pincode deactivated', schema: pincodeAdminSchema },
      422: jsonError('Reason missing'),
    },
  },
});

// ── Serialisation ─────────────────────────────────────────────────────────

const toCityDto = (row: CityRow) => ({
  id: row.id,
  name: row.name,
  slug: row.slug,
  display_name: row.displayName ?? row.name,
  state: row.state,
  country: row.country,
  timezone: row.timezone,
  status: row.status,
  is_serviceable: row.status === 'ACTIVE',
  display_order: row.displayOrder,
  activated_at: row.activatedAt?.toISOString() ?? null,
  pincode_count: row.pincodeCount,
  active_pincode_count: row.activePincodeCount,
  created_at: row.createdAt.toISOString(),
  updated_at: row.updatedAt.toISOString(),
});

const toPincodeDto = (row: PincodeRow) => ({
  id: row.id,
  pincode: row.pincode,
  area_name: row.areaName,
  status: row.status,
  // Serviceable means BOTH gates pass: the city gate runs first (BR-SV9).
  is_serviceable: row.status === 'ACTIVE' && row.city.status === 'ACTIVE',
  city: {
    id: row.city.id,
    name: row.city.name,
    slug: row.city.slug,
    state: row.city.state,
  },
  display_order: row.displayOrder,
  activated_at: row.activatedAt?.toISOString() ?? null,
  created_at: row.createdAt.toISOString(),
  updated_at: row.updatedAt.toISOString(),
});

export function adminServiceabilityRoutes(): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  // ── Cities ──────────────────────────────────────────────────────────────

  app.get('/cities', async (c) => {
    const query = listCitiesQuerySchema.parse({
      limit: c.req.query('limit'),
      cursor: c.req.query('cursor'),
      status: c.req.query('status'),
      state: c.req.query('state'),
      q: c.req.query('q'),
    });

    const page = await c.env.services.serviceabilityAdmin.listCities(
      businessScope(c.env.businessId),
      query,
    );

    return c.json({ data: page.data.map(toCityDto), pagination: page.pagination });
  });

  app.post('/cities', async (c) => {
    const body = createCityBodySchema.parse(await c.req.json());
    const actor = c.get('actor');

    const city = await c.env.services.serviceabilityAdmin.createCity(
      businessScope(c.env.businessId),
      {
        name: body.name,
        slug: body.slug,
        displayName: body.display_name,
        state: body.state,
        country: body.country,
        timezone: body.timezone,
        displayOrder: body.display_order,
        actorUserId: actor.kind === 'ADMIN' ? actor.userId : undefined,
      },
    );

    return c.json(toCityDto(city), 201);
  });

  app.get('/cities/:id', async (c) => {
    const { id } = idParamSchema.parse({ id: c.req.param('id') });
    const city = await c.env.services.serviceabilityAdmin.getCity(
      businessScope(c.env.businessId),
      id,
    );
    return c.json(toCityDto(city));
  });

  app.patch('/cities/:id', async (c) => {
    const { id } = idParamSchema.parse({ id: c.req.param('id') });
    const body = updateCityBodySchema.parse(await c.req.json());
    const actor = c.get('actor');

    const city = await c.env.services.serviceabilityAdmin.updateCity(
      businessScope(c.env.businessId),
      id,
      {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.display_name !== undefined ? { displayName: body.display_name } : {}),
        ...(body.state !== undefined ? { state: body.state } : {}),
        ...(body.country !== undefined ? { country: body.country } : {}),
        ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
        ...(body.display_order !== undefined ? { displayOrder: body.display_order } : {}),
        actorUserId: actor.kind === 'ADMIN' ? actor.userId : undefined,
      },
    );

    return c.json(toCityDto(city));
  });

  app.post('/cities/:id/activate', async (c) => {
    const { id } = idParamSchema.parse({ id: c.req.param('id') });
    const actor = c.get('actor');

    const city = await c.env.services.serviceabilityAdmin.activateCity(
      businessScope(c.env.businessId),
      id,
      actor.kind === 'ADMIN' ? actor.userId : undefined,
    );

    c.get('logger')?.info({ msg: 'city.activated', city_id: id }, 'city activated');
    return c.json(toCityDto(city));
  });

  app.post('/cities/:id/deactivate', async (c) => {
    const { id } = idParamSchema.parse({ id: c.req.param('id') });
    const body = deactivateBodySchema.parse(await c.req.json());
    const actor = c.get('actor');

    const city = await c.env.services.serviceabilityAdmin.deactivateCity(
      businessScope(c.env.businessId),
      id,
      body.reason,
      actor.kind === 'ADMIN' ? actor.userId : undefined,
    );

    c.get('logger')?.warn(
      { msg: 'city.deactivated', city_id: id, reason: body.reason },
      'city deactivated',
    );
    return c.json(toCityDto(city));
  });

  // ── Pincodes ────────────────────────────────────────────────────────────

  app.get('/service-pincodes', async (c) => {
    const query = listPincodesQuerySchema.parse({
      limit: c.req.query('limit'),
      cursor: c.req.query('cursor'),
      city_id: c.req.query('city_id'),
      status: c.req.query('status'),
      q: c.req.query('q'),
    });

    const page = await c.env.services.serviceabilityAdmin.listPincodes(
      businessScope(c.env.businessId),
      { ...query, cityId: query.city_id },
    );

    return c.json({ data: page.data.map(toPincodeDto), pagination: page.pagination });
  });

  app.post('/service-pincodes', async (c) => {
    const body = createPincodeBodySchema.parse(await c.req.json());
    const actor = c.get('actor');

    const pincode = await c.env.services.serviceabilityAdmin.createPincode(
      businessScope(c.env.businessId),
      {
        cityId: body.city_id,
        pincode: body.pincode,
        areaName: body.area_name,
        displayOrder: body.display_order,
        actorUserId: actor.kind === 'ADMIN' ? actor.userId : undefined,
      },
    );

    return c.json(toPincodeDto(pincode), 201);
  });

  app.get('/service-pincodes/:id', async (c) => {
    const { id } = idParamSchema.parse({ id: c.req.param('id') });
    const pincode = await c.env.services.serviceabilityAdmin.getPincode(
      businessScope(c.env.businessId),
      id,
    );
    return c.json(toPincodeDto(pincode));
  });

  app.patch('/service-pincodes/:id', async (c) => {
    const { id } = idParamSchema.parse({ id: c.req.param('id') });
    const body = updatePincodeBodySchema.parse(await c.req.json());
    const actor = c.get('actor');

    const pincode = await c.env.services.serviceabilityAdmin.updatePincode(
      businessScope(c.env.businessId),
      id,
      {
        ...(body.city_id !== undefined ? { cityId: body.city_id } : {}),
        ...(body.area_name !== undefined ? { areaName: body.area_name } : {}),
        ...(body.display_order !== undefined ? { displayOrder: body.display_order } : {}),
        actorUserId: actor.kind === 'ADMIN' ? actor.userId : undefined,
      },
    );

    return c.json(toPincodeDto(pincode));
  });

  app.post('/service-pincodes/:id/activate', async (c) => {
    const { id } = idParamSchema.parse({ id: c.req.param('id') });
    const actor = c.get('actor');

    const result = await c.env.services.serviceabilityAdmin.activatePincode(
      businessScope(c.env.businessId),
      id,
      actor.kind === 'ADMIN' ? actor.userId : undefined,
    );

    // A warning, not an error: the pincode IS active, it is simply not yet
    // serviceable because its city is not (BR-SV9).
    return c.json({
      ...toPincodeDto(result.pincode),
      ...(result.warning ? { warning: result.warning } : {}),
    });
  });

  app.post('/service-pincodes/:id/deactivate', async (c) => {
    const { id } = idParamSchema.parse({ id: c.req.param('id') });
    const body = deactivateBodySchema.parse(await c.req.json());
    const actor = c.get('actor');

    const pincode = await c.env.services.serviceabilityAdmin.deactivatePincode(
      businessScope(c.env.businessId),
      id,
      body.reason,
      actor.kind === 'ADMIN' ? actor.userId : undefined,
    );

    return c.json(toPincodeDto(pincode));
  });

  return app;
}
