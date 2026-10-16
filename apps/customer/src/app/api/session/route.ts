import { NextResponse, type NextRequest } from 'next/server';

import { clearSessionCookie, writeSessionCookie } from '@/lib/session-cookie';

/**
 * First-party session-persistence endpoint for the customer web app (see
 * `lib/session-cookie.ts` for why this exists and what it does/doesn't
 * change about the API's auth contract).
 *
 * This endpoint never returns the token and never reads it back out for the
 * browser — it only WRITES it into an HttpOnly cookie the browser itself
 * then carries silently across reloads. Nothing server-side ever trusts
 * this cookie as proof of identity on its own: `SessionBootstrap` always
 * re-validates the restored token against `GET /v1/auth/me` before treating
 * the user as signed in.
 */

/** Same-origin check: a cross-site page can still fire a blind POST/DELETE
 *  at this URL (SameSite=Lax doesn't stop the request, only whether ITS OWN
 *  cookies ride along), so this is the actual guard against a forged
 *  request — `Sec-Fetch-Site` is set by the browser on every request and
 *  cannot be overridden by page script. Worst case without this check is
 *  low-severity (a forged POST can't know a real token value to inject; a
 *  forged DELETE can only force a sign-out) but there's no reason not to
 *  close it outright. */
function isSameOriginRequest(request: NextRequest): boolean {
  const site = request.headers.get('sec-fetch-site');
  // Missing header = an old browser or a non-fetch client (e.g. curl) —
  // fails closed rather than assuming same-origin.
  return site === 'same-origin';
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { token?: unknown } | null;
  if (!body || typeof body.token !== 'string' || body.token.length === 0) {
    return NextResponse.json({ error: 'A non-empty token is required' }, { status: 422 });
  }

  await writeSessionCookie(body.token);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}
