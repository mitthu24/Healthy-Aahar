import { NextResponse, type NextRequest } from 'next/server';

/**
 * Server-side auth gate (Phase 04 follow-up).
 *
 * Previously NOTHING enforced authentication for the admin app at all —
 * `layout.tsx` and every `page.tsx` rendered unconditionally, and the only
 * auth-aware code (`auth-status.tsx`) was a client component that fetched
 * `/v1/admin/auth/me` after first paint just to swap a nav button; it never
 * redirected an anonymous visitor away from `/` or any other route. An
 * unauthenticated visitor could load the full admin shell (and, on routes
 * that don't themselves gate their data fetch, briefly see cached/initial
 * UI) before anything noticed they had no session.
 *
 * This runs before any page renders and only checks for the PRESENCE of
 * the `__Host-admin_session` cookie (its name mirrors
 * `apps/api/src/routes/admin/auth.ts`'s `SESSION_COOKIE` constant) — it
 * cannot validate the session itself (that requires a DB round-trip the
 * API already does, not something to duplicate at the edge). A present-but-
 * expired/revoked cookie still reaches the API, which rejects it with
 * `UNAUTHENTICATED`/`PASSWORD_CHANGE_REQUIRED`; that is handled by each
 * page's own data-fetching error handling, not this middleware. This
 * closes the actual gap: no session cookie at all now never reaches any
 * admin page's content.
 */

const SESSION_COOKIE = '__Host-admin_session';

const PUBLIC_PATHS = new Set(['/login', '/password-setup']);

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  const hasSession = request.cookies.has(SESSION_COOKIE);
  if (!hasSession) {
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  // Everything except Next internals, static files, and the public auth
  // pages themselves (listed above, checked in code since the matcher
  // syntax can't express "all except these two paths" alongside the asset
  // exclusions cleanly).
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt).*)'],
};
