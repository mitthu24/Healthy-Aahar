import { setSessionToken } from './session-store';

/**
 * Client-side counterpart to `lib/session-cookie.ts`: every place that used
 * to call `setSessionToken` directly (login, register, sign-out) now goes
 * through here instead, so the in-memory token and the persisted HttpOnly
 * cookie never drift apart. The cookie write/clear is fire-and-forget
 * relative to the UI — a failure here degrades gracefully to the original
 * (pre-fix) behavior of a reload losing the session, never to a broken
 * signed-in state, since `setSessionToken` always runs regardless.
 */

export function persistSessionToken(token: string): void {
  setSessionToken(token);
  void fetch('/api/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  }).catch(() => undefined);
}

export function clearPersistedSessionToken(): void {
  setSessionToken(null);
  void fetch('/api/session', { method: 'DELETE' }).catch(() => undefined);
}
