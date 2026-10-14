'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { AuthStatus } from '@/app/auth-status';
import { apiClient } from '@/lib/api-client';

import { MobileNav } from './mobile-nav';
import { Sidebar } from './sidebar';

const CHROMELESS_PATHS = new Set(['/login', '/password-setup', '/change-password']);

/**
 * App chrome for every admin page — desktop sidebar, mobile header/drawer/
 * bottom-bar, account menu. Lives in the root layout (same position the old
 * `AdminNav` occupied), so `/login` and `/password-setup` — the two routes
 * an unauthenticated visitor must reach — still render with zero chrome,
 * same as before. `/change-password` also stays chromeless on purpose: the
 * old `AdminNav` hid entirely there too, so a mid-forced-reset admin can't
 * navigate away before finishing it.
 *
 * Permission fetching is intentionally independent from `AuthGate`'s own
 * session check (same duplication the old `AdminNav` had) — this component
 * renders in the root layout, outside the `(protected)` route group
 * `AuthGate` wraps, so it has no access to that check's result. Hiding a nav
 * item here is a UI nicety only; the API enforces every permission
 * server-side regardless of what this component decides to show.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [permissions, setPermissions] = useState<Set<string> | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  useEffect(() => {
    void apiClient
      .adminMe()
      .then((me) => {
        setPermissions(new Set(me.permissions));
        setIsSuperAdmin(me.is_super_admin);
      })
      .catch(() => {
        setPermissions(new Set());
        setIsSuperAdmin(false);
      });
  }, [pathname]);

  if (CHROMELESS_PATHS.has(pathname)) {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-dvh">
      <Sidebar permissions={permissions} isSuperAdmin={isSuperAdmin} />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileNav permissions={permissions} isSuperAdmin={isSuperAdmin} />
        <div className="border-sand-200 bg-sand-0 hidden justify-end border-b px-6 py-2.5 lg:flex">
          <AuthStatus />
        </div>
        {/* A plain div, not <main> — every page already renders its own
            single <main> landmark; nesting a second one here would confuse
            screen-reader landmark navigation. */}
        <div className="min-w-0 flex-1 pb-20 lg:pb-0">{children}</div>
      </div>
    </div>
  );
}
