'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { AuthStatus } from '@/app/auth-status';
import { getCartItemCount, subscribeCartItemCount } from '@/lib/cart-store';

function CartIcon({ count }: { count: number }) {
  return (
    <Link
      href="/cart"
      aria-label={`Cart, ${count} item${count === 1 ? '' : 's'}`}
      className="hover:bg-sand-100 relative inline-flex h-11 w-11 items-center justify-center rounded-md"
    >
      <svg viewBox="0 0 24 24" className="text-sand-800 h-6 w-6" fill="none" aria-hidden="true">
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
      {count > 0 ? (
        <span className="text-sand-0 text-caption absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-green-600 px-1 leading-none">
          {count > 99 ? '99+' : count}
        </span>
      ) : null}
    </Link>
  );
}

/** Sticky brand header: search, category entry point, cart badge, account control. */
export function Header() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [cartCount, setCartCount] = useState(0);

  useEffect(() => {
    setCartCount(getCartItemCount());
    return subscribeCartItemCount(() => setCartCount(getCartItemCount()));
  }, []);

  function onSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const q = query.trim();
    router.push(q ? `/search?q=${encodeURIComponent(q)}` : '/search');
  }

  return (
    <header className="bg-sand-0 border-sand-200 sticky top-0 z-20 border-b">
      <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
        <Link href="/" className="font-display text-heading-sm shrink-0 text-green-700">
          Healthy Aahar
        </Link>

        <form onSubmit={onSearchSubmit} className="min-w-0 flex-1">
          <label htmlFor="site-search" className="sr-only">
            Search products
          </label>
          <input
            id="site-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search for dal, millets, khichdi..."
            className="border-sand-200 bg-sand-50 text-body-sm h-10 w-full rounded-full border px-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600"
          />
        </form>

        <CartIcon count={cartCount} />
        <AuthStatus />
      </div>
    </header>
  );
}
