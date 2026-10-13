'use client';

import { Skeleton } from '@healthy-aahar/ui';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { apiClient } from '@/lib/api-client';

/**
 * Client-side auth boundary for every protected admin route (PHASE 04
 * hotfix — replaces `middleware.ts`, deleted alongside this).
 *
 * `middleware.ts` tried to gate access by checking for the
 * `__Host-admin_session` cookie on the INCOMING request to this app's own
 * origin (`healthy-aahar-admin.vercel.app`). That cookie is set by, and
 * scoped host-only to, the API's origin (`api-production-ebea.up.
 * railway.app`) — a browser never attaches a cookie to a request toward a
 * DIFFERENT origin than the one that set it, regardless of `SameSite` or
 * any other attribute. So the incoming request Next.js middleware
 * inspects NEVER carries that cookie, for an authenticated visitor just
 * as much as an anonymous one — every single protected-route load was
 * redirected to `/login`, including right after a successful sign-in
 * (login succeeds -> client navigates to the dashboard -> middleware
 * intercepts that navigation -> sees no cookie -> bounces back to
 * `/login`). This is a structural property of cross-origin cookies, not
 * a bug fixable by reading the cookie differently in middleware.
 *
 * The fix moves the check to where the cookie genuinely IS visible: a
 * `fetch` from this page's own JavaScript straight to the API, with
 * `credentials: 'include'` (which `ApiClient` already sets on every
 * request) — the browser attaches the session cookie correctly on THAT
 * request, because it targets the cookie's own origin. `GET /v1/admin/
 * auth/me` is the API's own session-validation endpoint — this performs
 * the exact same server-side check PR #13 intended, just invoked from a
 * place that can actually see the credential, rather than middleware
 * guessing from a cookie it structurally cannot observe. Authorization
 * for every protected operation remains fully enforced server-side by
 * `adminAuth` middleware in the API regardless of what this component
 * decides to render (never trust a client-controlled signal as proof of
 * authentication) — this only controls what the ADMIN APP shows before
 * that server-side truth is known, not what the API accepts.
 *
 * Trade-off versus edge middleware: a brief loading state is shown on
 * the very first check, rather than middleware's instant pre-render
 * redirect. That is the honest cost of this cross-origin topology — the
 * only way to get an edge-redirect with zero flash would be for the
 * admin app to proxy session-bearing requests through its own origin
 * (so the cookie becomes first-party), a materially bigger architectural
 * change than this hotfix is scoped for.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [status, setStatus] = useState<'checking' | 'authenticated' | 'redirecting'>('checking');
  /** True once this gate has confirmed a session at least once this page load. */
  const hasConfirmedOnce = useRef(false);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .adminMe()
      .then(() => {
        if (cancelled) return;
        hasConfirmedOnce.current = true;
        setStatus('authenticated');
      })
      .catch(() => {
        if (cancelled) return;
        // Any failure here (expired/invalid/missing session, or a genuine
        // network error) means this page's own protected data fetches
        // would fail identically — redirecting is strictly more useful
        // than rendering a page that can't load its own data. The API
        // itself remains the sole source of truth on whether the session
        // is actually valid; this redirect is advisory UI only.
        setStatus('redirecting');
        router.replace('/login');
      });
    return () => {
      cancelled = true;
    };
    // Re-checks on every navigation into a protected route (the `pathname`
    // dependency), not just on first mount — this layout persists across
    // sibling route changes in the App Router, so without it a session
    // revoked or expired after the initial check (e.g. logout in another
    // tab) would never be re-verified on a later navigation. Does NOT
    // reset `status` back to 'checking' on these later re-checks (see
    // render logic below) — only the very first check blocks rendering;
    // subsequent ones are silent so normal in-app navigation never
    // flashes a loading skeleton.
  }, [router, pathname]);

  // Block rendering only for the FIRST check on this page load. A later
  // re-check (new `pathname`) runs silently in the background — children
  // stay mounted optimistically and only unmount if that re-check reports
  // the session is no longer valid, redirecting to /login.
  if (status !== 'authenticated' && !hasConfirmedOnce.current) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-12">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mt-4 h-40 w-full" />
      </main>
    );
  }
  if (status === 'redirecting') {
    return null;
  }

  return <>{children}</>;
}
