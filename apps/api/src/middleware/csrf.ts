import { getCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';

import { DomainError } from '@healthy-aahar/core';
import { CSRF_COOKIE, CSRF_HEADER, verifyCsrfToken } from '@healthy-aahar/auth';

import type { AppBindings } from '../types.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const LOGIN_PATH = '/v1/admin/auth/session';

/**
 * Double-submit CSRF check for mutating admin requests (docs/07 §5.2,
 * docs/23 §6). Defence in depth alongside `SameSite=Strict` — see
 * `packages/auth/src/csrf.ts` for why both exist.
 */
export const csrfProtection = createMiddleware<AppBindings>(async (c, next) => {
  if (SAFE_METHODS.has(c.req.method) || c.req.path === LOGIN_PATH) {
    await next();
    return;
  }

  const cookieValue = getCookie(c, CSRF_COOKIE);
  const headerValue = c.req.header(CSRF_HEADER);
  const secret = c.env.env.ADMIN_CSRF_SECRET;

  if (!verifyCsrfToken(secret, cookieValue, headerValue)) {
    throw new DomainError('CSRF_TOKEN_INVALID', 'Missing or invalid CSRF token.');
  }

  await next();
});
