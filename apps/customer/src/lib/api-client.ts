import { ApiClient } from '@healthy-aahar/sdk';

import { env } from './env';
import { getSessionToken } from './session-store';

/** Shared customer API client (PHASE 03 — email/password, bearer session token). */
export const apiClient = new ApiClient({
  baseUrl: env.NEXT_PUBLIC_API_BASE_URL,
  getToken: async () => getSessionToken(),
});
