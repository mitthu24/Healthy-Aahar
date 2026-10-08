import type { Hono } from 'hono';

import type { AppBindings } from '../types.js';
import { fakeToken } from './fake-auth.js';

/**
 * Drives the real `POST /v1/admin/auth/session` route with a fake ID token
 * and returns everything a subsequent request needs to act as that admin:
 * the `Cookie` header (session + CSRF cookie) and the CSRF header value for
 * mutating requests. Integration tests use this instead of a dev-token
 * header — there is no dev-token header anymore (ADR-030 superseded).
 */
export async function loginAsAdmin(
  app: Hono<AppBindings>,
  firebaseUid: string,
): Promise<{ cookieHeader: string; csrfHeader: string; headers: Record<string, string> }> {
  const res = await app.request('/v1/admin/auth/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id_token: fakeToken({ uid: firebaseUid }) }),
  });

  if (res.status !== 200) {
    const body = await res.text();
    throw new Error(`loginAsAdmin failed: ${res.status} ${body}`);
  }

  const setCookies = res.headers.getSetCookie?.() ?? [res.headers.get('set-cookie') ?? ''].filter(Boolean);
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
