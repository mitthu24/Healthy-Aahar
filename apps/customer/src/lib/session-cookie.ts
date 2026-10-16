/**
 * Server-only persistence for the customer session token (fixes: session
 * lost on reload).
 *
 * The API's customer auth stays bearer-token, cookie-free by design (docs/07
 * §4.3, docs/30 §2 — mobile parity: web and a future native client use the
 * identical `Authorization: Bearer` contract, no cookie). This file does NOT
 * change that contract. It solves persistence purely at the web frontend
 * layer: this app's OWN Next.js server sets a first-party, HttpOnly cookie
 * on ITS OWN origin (`healthy-aahar-customer.vercel.app`), separate from and
 * invisible to the API's origin. The API never sees or trusts this cookie —
 * every request to it still authenticates via the `Authorization` header
 * exactly as before, so admin/delivery and the documented mobile contract
 * are completely unaffected.
 *
 * `HttpOnly` + never written to `localStorage`/`sessionStorage` preserves
 * the original design's XSS posture: injected page script still cannot read
 * the token at rest between reloads, same as today where no persistence
 * exists at all. What changes is that a legitimate same-origin page load can
 * now have the SERVER (not client script) hand the token back to the
 * client's in-memory store in one step, instead of forcing a full re-login.
 */
import { cookies } from 'next/headers';

export const SESSION_COOKIE_NAME = 'ha_customer_session';

/** Matches the API's own customer session lifetime (docs/07 §2: "30 days,
 *  no idle timeout") — the cookie's own expiry is just a cap; the API's
 *  `sessions.expires_at` is the real authority and is re-checked on every
 *  request regardless of what this cookie says. */
const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export async function readSessionCookie(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE_NAME)?.value ?? null;
}

export async function writeSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE_NAME);
}
