/**
 * In-memory customer session token (PHASE 03, docs/07 §4.3, docs/30 §2).
 *
 * This is still the single live value every API call reads via
 * `ApiClient`'s `getToken` — deliberately NOT `localStorage`/
 * `sessionStorage`, and never a cookie the API itself can read (that stays
 * true: the customer API is bearer-token, cookie-free by design). A future
 * native app stores the same token in platform secure storage (Keychain/
 * Keystore) instead of this in-memory variable, with no API change on
 * either side.
 *
 * It no longer resets to `null` on every reload: `components/
 * session-bootstrap.tsx` repopulates it from a first-party HttpOnly cookie
 * (`lib/session-cookie.ts`) that this module knows nothing about and never
 * reads itself — `setSessionToken`/`getSessionToken` stay a plain in-memory
 * store either way. See `lib/session-cookie.ts` for the persistence design
 * and why it doesn't change the API's own auth contract.
 */
let token: string | null = null;
const listeners = new Set<() => void>();

export function getSessionToken(): string | null {
  return token;
}

export function setSessionToken(next: string | null): void {
  token = next;
  for (const listener of listeners) listener();
}

export function subscribeSessionToken(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
