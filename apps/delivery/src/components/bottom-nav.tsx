'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/', label: 'Home' },
  { href: '/orders', label: 'Deliveries' },
  { href: '/profile', label: 'Profile' },
] as const;

/** Fixed bottom tab bar — large touch targets, app-like feel on a phone. */
export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="bg-sand-0 border-sand-200 fixed inset-x-0 bottom-0 z-20 border-t pb-[env(safe-area-inset-bottom)]"
      aria-label="Primary"
    >
      <div className="mx-auto flex max-w-md">
        {TABS.map((tab) => {
          const active = tab.href === '/' ? pathname === '/' : pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`text-body-sm flex-1 py-3 text-center font-medium ${
                active ? 'text-green-600' : 'text-sand-500'
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
