import { ApiClient } from '@healthy-aahar/sdk';

import { env } from './env';

/**
 * Shared admin API client (PHASE 03 — email/password, DB-backed session
 * cookie, docs/07 §5).
 *
 * No `getCsrfToken` here: this app and the API are deployed on different
 * origins (a Vercel project vs a Railway service), and a browser never lets
 * JS on one origin read a cookie set by another via `document.cookie` —
 * reading the non-HttpOnly `admin_csrf` cookie that way always returns
 * `undefined` here, regardless of the cookie's own `SameSite`/`Secure`
 * settings. `ApiClient` instead captures the CSRF token itself from the
 * `X-CSRF-Token` response header the login route sends (already exposed
 * via CORS) and echoes it back automatically — see its `csrfToken` field.
 * The session cookie itself is never read or stored by this app; the
 * browser sends it automatically because every request goes through
 * `credentials: 'include'`.
 */
export const apiClient = new ApiClient({
  baseUrl: env.NEXT_PUBLIC_API_BASE_URL,
});
