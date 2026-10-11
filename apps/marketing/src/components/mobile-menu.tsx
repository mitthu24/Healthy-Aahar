'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

import { Button } from '@healthy-aahar/ui';

import { env } from '@/lib/env';

import { CloseIcon, MenuIcon } from './icons';

const LINKS = [
  { href: '/products', label: 'Shop' },
  { href: '/subscriptions', label: 'Subscriptions' },
  { href: '/how-it-works', label: 'How it works' },
  { href: '/about', label: 'About' },
  { href: '/faq', label: 'FAQ' },
] as const;

export function MobileMenu() {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = overflow;
    };
  }, [isOpen]);

  return (
    <div className="md:hidden">
      <button
        type="button"
        aria-label={isOpen ? 'Close menu' : 'Open menu'}
        aria-expanded={isOpen}
        aria-controls="mobile-nav"
        onClick={() => setIsOpen((v) => !v)}
        className="text-sand-800 -mr-2 flex h-11 w-11 items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600"
      >
        {isOpen ? <CloseIcon className="h-6 w-6" /> : <MenuIcon className="h-6 w-6" />}
      </button>

      {isOpen ? (
        <div className="fixed inset-0 z-40 h-dvh w-dvw md:hidden">
          <button
            type="button"
            aria-label="Close menu"
            className="bg-sand-900/40 fixed inset-0 h-dvh w-dvw"
            onClick={() => setIsOpen(false)}
          />
          <nav
            id="mobile-nav"
            aria-label="Mobile"
            className="bg-sand-0 fixed bottom-0 right-0 top-0 flex h-dvh w-[82%] max-w-sm flex-col gap-1 overflow-y-auto px-6 py-6 shadow-xl"
          >
            <div className="mb-4 flex items-center justify-between">
              <span className="font-display text-heading-sm text-green-800">Healthy Aahar</span>
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setIsOpen(false)}
                className="text-sand-600 flex h-11 w-11 items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600"
              >
                <CloseIcon className="h-6 w-6" />
              </button>
            </div>

            {LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setIsOpen(false)}
                className="text-body-lg text-sand-800 hover:bg-sand-50 -mx-2 rounded-md px-2 py-3 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600"
              >
                {link.label}
              </Link>
            ))}

            <div className="border-sand-200 mt-4 flex flex-col gap-3 border-t pt-5">
              <a href={`${env.NEXT_PUBLIC_APP_URL}/login`}>
                <Button variant="secondary" size="lg" className="w-full">
                  Sign in
                </Button>
              </a>
              <a href={`${env.NEXT_PUBLIC_APP_URL}/products?ref=marketing`}>
                <Button size="lg" className="w-full">
                  Shop now
                </Button>
              </a>
            </div>
          </nav>
        </div>
      ) : null}
    </div>
  );
}
