import { ApiClient } from '@healthy-aahar/sdk';

import { env } from './env';

/**
 * Public-catalogue API client (docs/16 §2). No session, no auth — the
 * marketing site renders only public data (BR-MK5).
 */
export const apiClient = new ApiClient({ baseUrl: env.NEXT_PUBLIC_API_BASE_URL });
