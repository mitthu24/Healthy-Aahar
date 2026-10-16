'use client';

import { useEffect, useRef } from 'react';

import { apiClient } from '@/lib/api-client';
import { clearPersistedSessionToken } from '@/lib/session-client';
import { setSessionToken } from '@/lib/session-store';

/**
 * Restores the customer session after a hard reload (fixes: session lost on
 * reload — see `lib/session-cookie.ts` for the persistence design).
 *
 * `initialToken` comes from the server (the layout read the HttpOnly cookie
 * via `next/headers`) and is set into the in-memory store immediately —
 * optimistic, so the header shows "Sign out" without a flash of "Sign in"
 * first. It is then re-validated against `GET /v1/auth/me` (same pattern as
 * the admin app's `AuthGate`): if the session was revoked or has expired
 * server-side since the cookie was written, this clears both the in-memory
 * token and the cookie so the UI correctly reverts to signed-out rather
 * than staying in a broken state where every subsequent call 401s. The API
 * remains the sole source of truth either way — this only controls what
 * the UI optimistically shows before that server-side check completes.
 */
export function SessionBootstrap({ initialToken }: { initialToken: string | null }) {
  // Runs the restore-and-verify sequence at most once per page load —
  // StrictMode's intentional double-invoke of effects in development must
  // not fire two concurrent /auth/me checks (harmless, but wasteful) or,
  // worse, race a sign-out that happens between the two mounts.
  const hasRun = useRef(false);

  useEffect(() => {
    if (hasRun.current) return;
    hasRun.current = true;
    if (!initialToken) return;

    setSessionToken(initialToken);

    let cancelled = false;
    apiClient.customerMe().catch(() => {
      if (cancelled) return;
      clearPersistedSessionToken();
    });
    return () => {
      cancelled = true;
    };
  }, [initialToken]);

  return null;
}
