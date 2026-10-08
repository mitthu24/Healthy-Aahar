import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Double-submit CSRF token for the admin session cookie.
 *
 * `SameSite=Strict` on the session cookie already blocks the vast majority of
 * CSRF, but it is a browser behaviour, not a server guarantee (docs/23 §6) —
 * some older browsers and some navigation types (top-level GET links from
 * mail clients) do not honour it consistently. The token below is issued at
 * login, stored in a non-`HttpOnly` cookie (so client JS can read it) and
 * echoed back in a header on every mutating admin request; the server
 * verifies the header against an HMAC of the cookie value rather than a
 * plain string compare, so a value alone (without the server's secret)
 * cannot be forged.
 */

const CSRF_HEADER = 'x-csrf-token';
const CSRF_COOKIE = 'admin_csrf';

export { CSRF_HEADER, CSRF_COOKIE };

export function generateCsrfToken(secret: string): string {
  const nonce = randomBytes(16).toString('hex');
  const signature = createHmac('sha256', secret).update(nonce).digest('hex');
  return `${nonce}.${signature}`;
}

export function verifyCsrfToken(secret: string, cookieValue: string | undefined, headerValue: string | undefined): boolean {
  if (!cookieValue || !headerValue) return false;
  if (cookieValue !== headerValue) return false;

  const [nonce, signature] = cookieValue.split('.');
  if (!nonce || !signature) return false;

  const expected = createHmac('sha256', secret).update(nonce).digest('hex');
  const a = Buffer.from(signature, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
