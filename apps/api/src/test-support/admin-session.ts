import type { Hono } from 'hono';

import type { AppBindings } from '../types.js';

/**
 * Drives the real `POST /v1/admin/auth/login` route with a seeded admin's
 * real email + password (PHASE 03 — docs/07 §5) and returns everything a
 * subsequent request needs to act as that admin: the `Cookie` header
 * (session + CSRF cookie) and the CSRF header value for mutating requests.
 *
 * Unlike the Firebase-era version of this helper, there is no fake token —
 * the session this mints is a REAL row in the test database's `sessions`
 * table, verified through the exact same code path production uses.
 */
export async function loginAsAdmin(
  app: Hono<AppBindings>,
  /** STAGE C: either `email` or `loginId` identifies the account — exactly
   *  one is expected, matching the real login route's single `identifier`
   *  field. */
  credentials: { email?: string | null; loginId?: string | null; password: string },
): Promise<{ cookieHeader: string; csrfHeader: string; headers: Record<string, string> }> {
  const identifier = credentials.email ?? credentials.loginId;
  if (!identifier) throw new Error('loginAsAdmin requires an email or a loginId');

  // The wire field is still named `email` (see adminLoginBodySchema's doc
  // comment) — it accepts a login ID too, so this helper just forwards
  // whichever identifier the caller supplied under that same key.
  const res = await app.request('/v1/admin/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: identifier, password: credentials.password }),
  });

  if (res.status !== 200) {
    const body = await res.text();
    throw new Error(`loginAsAdmin failed: ${res.status} ${body}`);
  }

  const setCookies =
    res.headers.getSetCookie?.() ?? [res.headers.get('set-cookie') ?? ''].filter(Boolean);
  const cookieHeader = setCookies.map((c) => c.split(';')[0]).join('; ');
  const csrfHeader = res.headers.get('x-csrf-token') ?? '';

  return {
    cookieHeader,
    csrfHeader,
    headers: {
      Cookie: cookieHeader,
      'X-CSRF-Token': csrfHeader,
      'Content-Type': 'application/json',
    },
  };
}
