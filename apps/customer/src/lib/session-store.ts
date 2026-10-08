/**
 * In-memory customer session token (PHASE 03, docs/07 §4.3, docs/30 §2).
 *
 * Deliberately NOT `localStorage`/`sessionStorage`/a cookie — the token
 * lives only in this module's memory for the lifetime of the page. A
 * reload signs the user out, which is the correct trade-off for a web
 * client; a future native app stores the same token in platform secure
 * storage (Keychain/Keystore) instead of this in-memory variable, with no
 * API change on either side.
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
