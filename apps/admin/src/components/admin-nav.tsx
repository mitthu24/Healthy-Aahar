'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { AuthStatus } from '@/app/auth-status';
import { apiClient } from '@/lib/api-client';

const LINKS = [
  { href: '/orders', label: 'Orders' },
  { href: '/products', label: 'Products' },
  { href: '/categories', label: 'Categories' },
  { href: '/delivery-slots', label: 'Slots' },
  { href: '/employees', label: 'Employees', permission: 'admin_users:read' },
  {
    href: '/delivery-partners',
    label: 'Delivery Partners',
    permission: 'delivery_partners:read',
  },
  { href: '/roles', label: 'Roles', permission: 'roles:read' },
  { href: '/audit-log', label: 'Audit', permission: 'audit:read' },
] as const;

/**
 * `permission`-gated links are hidden, not just disabled, for a visitor who
 * doesn't hold it — a visual nicety only (requirement: never rely on the
 * frontend for security). The API enforces every one of these permissions
 * independently on the routes themselves; hiding the link here just avoids
 * sending someone to a page that would 403 on every request it makes.
 */
export function AdminNav() {
  const pathname = usePathname();
  const [permissions, setPermissions] = useState<Set<string> | null>(null);

  useEffect(() => {
    void apiClient
      .adminMe()
      .then((me) => setPermissions(new Set(me.permissions)))
      .catch(() => setPermissions(new Set()));
  }, [pathname]);

  if (pathname === '/login' || pathname === '/change-password' || pathname === '/password-setup') {
    return null;
  }

  const visibleLinks = LINKS.filter(
    (link) => !('permission' in link) || permissions?.has(link.permission),
  );

  return (
    <header className="bg-sand-0 border-sand-200 sticky top-0 z-20 border-b">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-4 overflow-x-auto sm:gap-6">
          <Link href="/" className="font-display text-heading-sm shrink-0 text-green-700">
            Healthy Aahar
          </Link>
          <nav className="flex shrink-0 gap-3 sm:gap-4">
            {visibleLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`text-body-sm shrink-0 whitespace-nowrap font-medium ${pathname.startsWith(link.href) ? 'text-green-600' : 'text-sand-600'}`}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="shrink-0">
          <AuthStatus />
        </div>
      </div>
    </header>
  );
}
