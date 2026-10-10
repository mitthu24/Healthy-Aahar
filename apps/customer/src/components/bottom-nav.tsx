'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  { href: '/', label: 'Home', icon: 'home' },
  { href: '/products', label: 'Shop', icon: 'shop' },
  { href: '/cart', label: 'Cart', icon: 'cart' },
  { href: '/orders', label: 'Orders', icon: 'orders' },
  { href: '/account', label: 'Account', icon: 'account' },
] as const;

function Icon({ name, className }: { name: (typeof ITEMS)[number]['icon']; className?: string }) {
  const common = { viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true, className } as const;
  switch (name) {
    case 'home':
      return (
        <svg {...common}>
          <path
            d="M4 11.5 12 4l8 7.5V20a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
        </svg>
      );
    case 'shop':
      return (
        <svg {...common}>
          <path
            d="M4 9h16l-1 10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 9Z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          <path d="M8 9V7a4 4 0 1 1 8 0v2" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      );
    case 'cart':
      return (
        <svg {...common}>
          <path
            d="M3 3h2l2.4 12.2a2 2 0 0 0 2 1.6h7.2a2 2 0 0 0 2-1.6L21 7H6"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="9" cy="20" r="1.4" fill="currentColor" />
          <circle cx="17" cy="20" r="1.4" fill="currentColor" />
        </svg>
      );
    case 'orders':
      return (
        <svg {...common}>
          <path
            d="M5 4h14v16l-3-2-2 2-2-2-2 2-2-2-3 2Z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          <path d="M8 9h8M8 13h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case 'account':
      return (
        <svg {...common}>
          <circle cx="12" cy="8" r="3.4" stroke="currentColor" strokeWidth="1.8" />
          <path
            d="M5 20c1.5-4 4.3-6 7-6s5.5 2 7 6"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      );
  }
}

/** Mobile bottom tab bar — hidden on larger screens, where the header carries navigation. */
export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="bg-sand-0 border-sand-200 fixed inset-x-0 bottom-0 z-20 border-t pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul className="mx-auto flex max-w-2xl items-stretch justify-between px-2">
        {ITEMS.map((item) => {
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                className={`flex min-h-11 flex-col items-center justify-center gap-0.5 py-2 ${
                  active ? 'text-green-600' : 'text-sand-600'
                }`}
                aria-current={active ? 'page' : undefined}
              >
                <Icon name={item.icon} className="h-5 w-5" />
                <span className="text-caption">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
