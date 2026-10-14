import { ApiClient } from '@healthy-aahar/sdk';

import { env } from './env';

/**
 * Shared delivery-partner API client. A delivery partner IS an admin
 * session (same `__Host-admin_session` cookie, same login/me/logout
 * endpoints) — this app reuses the exact admin auth surface, gated by the
 * `deliveries:fulfil` permission rather than a separate audience. See
 * apps/admin/src/lib/api-client.ts for why there is no `getCsrfToken` here:
 * this app and the API are on different origins, so `ApiClient` captures
 * the CSRF token itself from the login response header instead of reading
 * a cookie no cross-origin JS could ever see.
 */
export const apiClient = new ApiClient({
  baseUrl: env.NEXT_PUBLIC_API_BASE_URL,
});
