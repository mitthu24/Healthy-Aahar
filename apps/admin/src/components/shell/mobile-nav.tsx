'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { AuthStatus } from '@/app/auth-status';
import { BOTTOM_NAV_HREFS, NAV_GROUPS, isNavItemActive } from '@/lib/nav';

import { CloseIcon, MenuIcon } from './icons';

/** Compact header + full-nav drawer + bottom tab bar — below the `lg` breakpoint, replacing the desktop sidebar entirely. */
export function MobileNav({ permissions }: { permissions: Set<string> | null }) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Close the drawer automatically on navigation.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!drawerOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setDrawerOpen(false);
    }
    document.addEventListener('keydown', onKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = '';
    };
  }, [drawerOpen]);

  const allItems = NAV_GROUPS.flatMap((g) => g.items);
  const bottomItems = BOTTOM_NAV_HREFS.map((href) => allItems.find((i) => i.href === href)).filter(
    (item): item is NonNullable<typeof item> =>
      item !== undefined && (!item.permission || permissions?.has(item.permission) === true),
  );

  return (
    <>
      <header className="bg-sand-0 border-sand-200 sticky top-0 z-30 flex h-14 items-center justify-between border-b px-4 pt-[env(safe-area-inset-top)] lg:hidden">
        <Link href="/" className="flex items-center gap-2">
          <span className="text-sand-0 flex h-7 w-7 items-center justify-center rounded-md bg-green-600 text-xs font-bold">
            HA
          </span>
          <span className="font-display text-body-sm text-sand-900 font-semibold">
            Healthy Aahar
          </span>
        </Link>
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open navigation menu"
          aria-expanded={drawerOpen}
          className="text-sand-700 flex h-11 w-11 items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600"
        >
          <MenuIcon className="h-6 w-6" />
        </button>
      </header>

      {drawerOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="bg-sand-900/40 absolute inset-0"
            aria-hidden="true"
            onClick={() => setDrawerOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            className="bg-sand-0 absolute inset-y-0 left-0 flex w-[85%] max-w-xs flex-col overflow-y-auto pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]"
          >
            <div className="flex h-14 shrink-0 items-center justify-between px-4">
              <span className="font-display text-body-md text-sand-900 font-semibold">Menu</span>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close navigation menu"
                className="text-sand-600 flex h-11 w-11 items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600"
              >
                <CloseIcon className="h-6 w-6" />
              </button>
            </div>
            <nav className="flex-1 px-3 pb-4">
              {NAV_GROUPS.map((group) => {
                const visibleItems = group.items.filter(
                  (item) => !item.permission || permissions?.has(item.permission),
                );
                if (visibleItems.length === 0) return null;
                return (
                  <div key={group.label} className="mb-4">
                    <p className="text-caption text-sand-400 mb-1 px-2.5 font-semibold uppercase tracking-wide">
                      {group.label}
                    </p>
                    <ul className="space-y-0.5">
                      {visibleItems.map((item) => {
                        const active = isNavItemActive(pathname, item.href);
                        const Icon = item.icon;
                        return (
                          <li key={item.href}>
                            <Link
                              href={item.href}
                              aria-current={active ? 'page' : undefined}
                              className={`text-body-md flex min-h-[44px] items-center gap-3 rounded-md px-2.5 py-2.5 font-medium ${
                                active ? 'bg-green-50 text-green-700' : 'text-sand-700'
                              }`}
                            >
                              <Icon className="h-5 w-5 shrink-0" />
                              {item.label}
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </nav>
            <div className="border-sand-100 border-t px-4 py-3">
              <AuthStatus />
            </div>
          </div>
        </div>
      ) : null}

      {bottomItems.length > 0 ? (
        <nav
          aria-label="Primary"
          className="bg-sand-0 border-sand-200 fixed inset-x-0 bottom-0 z-30 border-t pb-[env(safe-area-inset-bottom)] lg:hidden"
        >
          <div className="flex">
            {bottomItems.map((item) => {
              const active = isNavItemActive(pathname, item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={`flex min-h-[44px] flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium ${
                    active ? 'text-green-700' : 'text-sand-500'
                  }`}
                >
                  <Icon className="h-5 w-5" />
                  <span className="truncate px-1">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </nav>
      ) : null}
    </>
  );
}
