import { newId } from '@healthy-aahar/core';
import { createMiddleware } from 'hono/factory';

import type { AppBindings } from '../types.js';

const HEADER = 'x-request-id';

/**
 * Correlation id for every request.
 *
 * Accepts an upstream id from Cloudflare when present so one id traces a
 * request from the edge, through the API, into background jobs it triggers and
 * into Sentry (docs/28-OBSERVABILITY.md §2).
 */
export const requestId = createMiddleware<AppBindings>(async (c, next) => {
  const incoming = c.req.header(HEADER);
  // Only trust an upstream value that looks like an id. An unvalidated header
  // would end up in log fields and dashboards.
  const id = incoming && /^[A-Za-z0-9._-]{8,128}$/.test(incoming) ? incoming : newId();

  c.set('requestId', id);
  c.set('startedAt', performance.now());
  c.header(HEADER, id);

  await next();
});
