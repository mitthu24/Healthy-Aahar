import { ApiClient } from '@healthy-aahar/sdk';

import { env } from './env';
import { clearPersistedSessionToken } from './session-client';
import { getSessionToken } from './session-store';

/** Shared customer API client (PHASE 03 — email/password, bearer session token). */
export const apiClient = new ApiClient({
  baseUrl: env.NEXT_PUBLIC_API_BASE_URL,
  getToken: async () => getSessionToken(),
  // A session that goes bad mid-use (revoked, expired) must not leave the
  // UI showing "Sign out" for a token the API no longer honours — this is
  // the same cleanup `SessionBootstrap` does for a stale restored session,
  // triggered here for the "went bad while actively browsing" case instead.
  onUnauthorized: () => clearPersistedSessionToken(),
});
