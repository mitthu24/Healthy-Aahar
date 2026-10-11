'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { AuthStatus } from '@/app/auth-status';

const LINKS = [
  { href: '/orders', label: 'Orders' },
  { href: '/products', label: 'Products' },
  { href: '/categories', label: 'Categories' },
  { href: '/delivery-slots', label: 'Slots' },
] as const;

export function AdminNav() {
  const pathname = usePathname();
  if (pathname === '/login' || pathname === '/change-password') return null;

  return (
    <header className="bg-sand-0 border-sand-200 sticky top-0 z-20 border-b">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-4 overflow-x-auto sm:gap-6">
          <Link
            href="/"
            className="font-display text-heading-sm shrink-0 text-green-700"
          >
            Healthy Aahar
          </Link>
          <nav className="flex shrink-0 gap-3 sm:gap-4">
            {LINKS.map((link) => (
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
