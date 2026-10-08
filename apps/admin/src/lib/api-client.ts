import { ApiClient } from '@healthy-aahar/sdk';

import { env } from './env';

/**
 * Shared admin API client (PHASE 03 — email/password, DB-backed session
 * cookie, docs/07 §5).
 *
 * `getCsrfToken` reads the non-HttpOnly `admin_csrf` cookie the login route
 * sets alongside the session cookie — client JS is meant to read this one
 * (it is NOT the session itself) and echo it back on every mutating
 * request (docs/23 §6). The session cookie itself is never read or stored
 * by this app; the browser sends it automatically because every request
 * goes through `credentials: 'include'`.
 */
function readCookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

export const apiClient = new ApiClient({
  baseUrl: env.NEXT_PUBLIC_API_BASE_URL,
  getCsrfToken: () => readCookie('admin_csrf'),
});
