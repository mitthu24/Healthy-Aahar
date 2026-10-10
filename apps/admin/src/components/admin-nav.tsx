'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { AuthStatus } from '@/app/auth-status';

const LINKS = [{ href: '/orders', label: 'Orders' }] as const;

export function AdminNav() {
  const pathname = usePathname();
  if (pathname === '/login' || pathname === '/change-password') return null;

  return (
    <header className="bg-sand-0 border-sand-200 sticky top-0 z-20 border-b">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-3">
        <div className="flex items-center gap-6">
          <Link href="/" className="font-display text-heading-sm text-green-700">
            Healthy Aahar
          </Link>
          <nav className="flex gap-4">
            {LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`text-body-sm font-medium ${pathname.startsWith(link.href) ? 'text-green-600' : 'text-sand-600'}`}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
        <AuthStatus />
      </div>
    </header>
  );
}
