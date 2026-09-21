import {
  errorResponseSchema,
  publicCityListResponseSchema,
  serviceabilityQuerySchema,
  serviceabilityResponseSchema,
} from '@healthy-aahar/contracts';
import { Hono } from 'hono';

import { registerRoute } from '../../lib/route-registry.js';
import type { AppBindings } from '../../types.js';

/**
 * Public serviceability (docs/06-API-SPECIFICATION.md §4).
 *
 * This is the endpoint the marketing pincode checker, the customer address
 * form and (later) the mobile apps all call. It is the only public statement
 * of where we deliver, and it is computed from the database on every call.
 *
 * Note that a non-serviceable pincode returns **200**, not 404. The question
 * was answered successfully; the answer was "no". A 404 would be semantically
 * wrong and would make the caller treat a valid answer as a failure.
 */

registerRoute({
  method: 'GET',
  path: '/v1/public/serviceability',
  audience: 'public',
  summary: 'Check whether a pincode is serviceable',
  phase: '01',
  errors: ['INVALID_PINCODE'],
  openapi: {
    description:
      'A non-serviceable pincode returns HTTP 200 with is_serviceable=false, ' +
      'NOT a 404: the question was answered successfully (BR-SV11). The ' +
      'answer is recomputed from the database on every call; a client-supplied ' +
      'serviceability flag is never read (BR-SV1).',
    tags: ['Serviceability'],
    request: { query: serviceabilityQuerySchema },
    responses: {
      200: { description: 'Serviceability decision', schema: serviceabilityResponseSchema },
      422: { description: 'Malformed pincode', schema: errorResponseSchema },
    },
  },
});

registerRoute({
  method: 'GET',
  path: '/v1/public/cities',
  audience: 'public',
  summary: 'List serviceable cities',
  phase: '01',
  openapi: {
    tags: ['Serviceability'],
    responses: {
      200: { description: 'Active and coming-soon cities', schema: publicCityListResponseSchema },
    },
  },
});

export function publicServiceabilityRoutes(): Hono<AppBindings> {
  const app = new Hono<AppBindings>();

  app.get('/serviceability', async (c) => {
    // Parsed with the shared contract schema, so the API and every client
    // validate against one definition (docs/03 §2).
    const query = serviceabilityQuerySchema.parse({
      pincode: c.req.query('pincode') ?? '',
    });

    const result = await c.env.services.serviceability.checkForApi(c.env.businessId, query.pincode);

    c.get('logger')?.info(
      {
        msg: 'serviceability.checked',
        pincode: query.pincode,
        serviceable: result.is_serviceable,
        reason: result.reason,
      },
      'serviceability checked',
    );

    // Serviceability changes only when an admin changes it, so a short shared
    // cache is safe and takes the pincode checker off the database on the
    // marketing site's busiest path (docs/22 §5).
    return c.json(result, 200, {
      'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
    });
  });

  app.get('/cities', async (c) => {
    const cities = await c.env.prisma.city.findMany({
      where: { businessId: c.env.businessId, status: { in: ['ACTIVE', 'COMING_SOON'] } },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        slug: true,
        displayName: true,
        state: true,
        country: true,
        timezone: true,
        status: true,
      },
    });

    return c.json(
      {
        data: cities.map((city) => ({
          id: city.id,
          name: city.name,
          slug: city.slug,
          display_name: city.displayName ?? city.name,
          state: city.state,
          country: city.country,
          timezone: city.timezone,
          status: city.status,
          is_serviceable: city.status === 'ACTIVE',
        })),
        pagination: { limit: cities.length, next_cursor: null, has_more: false },
      },
      200,
      { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
    );
  });

  return app;
}
