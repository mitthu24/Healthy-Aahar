'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { NAV_GROUPS, isNavItemActive, isNavItemVisible } from '@/lib/nav';

import { ChevronLeftIcon } from './icons';

const COLLAPSE_KEY = 'admin-sidebar-collapsed';

/**
 * Desktop sidebar (lg breakpoint and up — below that, MobileNav takes over
 * entirely). Collapse state is a per-browser convenience persisted in
 * localStorage, never anything auth-related.
 */
export function Sidebar({
  permissions,
  isSuperAdmin = false,
}: {
  permissions: Set<string> | null;
  isSuperAdmin?: boolean;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === '1');
    } catch {
      // Private browsing / blocked storage — default to expanded, harmless.
    }
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      } catch {
        // Nothing to persist across reloads if storage is unavailable; the UI still works this session.
      }
      return next;
    });
  }

  return (
    <aside
      className={`border-sand-200 bg-sand-0 sticky top-0 hidden h-dvh shrink-0 flex-col border-r transition-[width] duration-200 lg:flex ${
        collapsed ? 'w-[4.5rem]' : 'w-64'
      }`}
    >
      <div className="border-sand-100 flex h-16 shrink-0 items-center border-b px-4">
        <Link href="/" className="flex min-w-0 items-center gap-2">
          <span className="text-sand-0 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-green-600 text-sm font-bold">
            HA
          </span>
          {!collapsed ? (
            <span className="font-display text-body-md text-sand-900 truncate font-semibold">
              Healthy Aahar
            </span>
          ) : null}
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Primary">
        {NAV_GROUPS.map((group) => {
          const visibleItems = group.items.filter((item) =>
            isNavItemVisible(item, permissions, isSuperAdmin),
          );
          if (visibleItems.length === 0) return null;
          return (
            <div key={group.label} className="mb-5">
              {!collapsed ? (
                <p className="text-caption text-sand-400 mb-1.5 px-2.5 font-semibold uppercase tracking-wide">
                  {group.label}
                </p>
              ) : null}
              <ul className="space-y-0.5">
                {visibleItems.map((item) => {
                  const active = isNavItemActive(pathname, item.href);
                  const Icon = item.icon;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        title={collapsed ? item.label : undefined}
                        aria-current={active ? 'page' : undefined}
                        className={`text-body-sm flex items-center gap-3 rounded-md px-2.5 py-2 font-medium transition-colors ${
                          active
                            ? 'bg-green-50 text-green-700'
                            : 'text-sand-700 hover:bg-sand-50 hover:text-sand-900'
                        } ${collapsed ? 'justify-center' : ''}`}
                      >
                        <Icon className="h-5 w-5 shrink-0" />
                        {!collapsed ? <span className="truncate">{item.label}</span> : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      <div className="border-sand-100 shrink-0 border-t p-3">
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
          className="text-sand-500 hover:bg-sand-50 hover:text-sand-800 flex w-full items-center justify-center gap-2 rounded-md py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600"
        >
          <ChevronLeftIcon
            className={`h-4 w-4 transition-transform ${collapsed ? 'rotate-180' : ''}`}
          />
          {!collapsed ? <span className="text-body-sm">Collapse</span> : null}
        </button>
      </div>
    </aside>
  );
}
