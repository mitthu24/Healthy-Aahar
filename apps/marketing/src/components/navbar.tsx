import Link from 'next/link';

import { Button } from '@healthy-aahar/ui';

import { env } from '@/lib/env';

import { Container } from './container';
import { MobileMenu } from './mobile-menu';

const LINKS = [
  { href: '/products', label: 'Shop' },
  { href: '/subscriptions', label: 'Subscriptions' },
  { href: '/how-it-works', label: 'How it works' },
  { href: '/about', label: 'About' },
  { href: '/faq', label: 'FAQ' },
] as const;

export function Navbar() {
  return (
    <header className="bg-sand-0/90 border-sand-200 sticky top-0 z-30 border-b backdrop-blur-sm">
      <Container className="flex h-16 items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <span className="font-display text-heading-md text-green-800">Healthy Aahar</span>
        </Link>

        <nav aria-label="Primary" className="hidden items-center gap-7 md:flex">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-body-sm text-sand-700 hover:text-green-700 focus-visible:ring-green-600 rounded-sm font-medium focus-visible:outline-none focus-visible:ring-2"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-3 md:flex">
          <Link
            href="/#check-delivery"
            className="text-body-sm text-sand-700 hover:text-green-700 focus-visible:ring-green-600 rounded-sm font-medium focus-visible:outline-none focus-visible:ring-2"
          >
            Check delivery
          </Link>
          <a href={`${env.NEXT_PUBLIC_APP_URL}/login`}>
            <Button variant="secondary" size="sm">
              Sign in
            </Button>
          </a>
          <a href={`${env.NEXT_PUBLIC_APP_URL}/products?ref=marketing`}>
            <Button size="sm">Shop now</Button>
          </a>
        </div>

        <MobileMenu />
      </Container>
    </header>
  );
}
