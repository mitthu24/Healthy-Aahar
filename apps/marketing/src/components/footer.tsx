import Link from 'next/link';

import { env } from '@/lib/env';

import { Container } from './container';
import { MailIcon, PhoneIcon } from './icons';

const SHOP_LINKS = [
  { href: '/products', label: 'Shop all' },
  { href: '/subscriptions', label: 'Subscriptions' },
  { href: '/how-it-works', label: 'How it works' },
] as const;

const COMPANY_LINKS = [
  { href: '/about', label: 'About us' },
  { href: '/faq', label: 'FAQ' },
  { href: '/contact', label: 'Contact' },
] as const;

const LEGAL_LINKS = [
  { href: '/terms', label: 'Terms & Conditions' },
  { href: '/privacy', label: 'Privacy Policy' },
  { href: '/refund-policy', label: 'Refund & Cancellation' },
  { href: '/delivery-policy', label: 'Shipping & Delivery' },
] as const;

// Every other focus-visible ring on the site is green (focus-visible:ring-
// green-600), which disappears against this footer's own bg-green-900 —
// citrus-400 is the one token in the palette with enough contrast against
// dark green, so the footer gets its own ring color, same ring/offset
// convention as everywhere else (docs/17 §5: focus rings are never removed,
// only ever restyled to stay visible on their own background).
const FOOTER_FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-citrus-400 focus-visible:ring-offset-2 focus-visible:ring-offset-green-900 focus-visible:rounded-sm';

export function Footer() {
  return (
    <footer className="bg-green-900 text-sand-100">
      <Container className="py-14">
        <div className="grid grid-cols-2 gap-10 sm:grid-cols-4">
          <div className="col-span-2 sm:col-span-1">
            <span className="font-display text-heading-sm text-sand-0">Healthy Aahar</span>
            <p className="text-body-sm text-sand-200 mt-3 max-w-xs">
              Fresh, honest, healthy food — prepared the morning we deliver it, to Noida.
            </p>
            <ul className="text-body-sm text-sand-200 mt-5 space-y-2">
              <li className="flex items-center gap-2">
                <PhoneIcon className="text-sand-400 h-4 w-4 shrink-0" />
                <a href="tel:+911204000000" className={`hover:text-sand-0 ${FOOTER_FOCUS}`}>
                  +91 120 400 0000
                </a>
              </li>
              <li className="flex items-center gap-2">
                <MailIcon className="text-sand-400 h-4 w-4 shrink-0" />
                <a
                  href="mailto:support@healthyaahar.com"
                  className={`hover:text-sand-0 ${FOOTER_FOCUS}`}
                >
                  support@healthyaahar.com
                </a>
              </li>
            </ul>
          </div>

          <nav aria-label="Shop">
            <h3 className="text-caption text-sand-400 font-semibold tracking-wide uppercase">
              Shop
            </h3>
            <ul className="mt-4 space-y-3">
              {SHOP_LINKS.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className={`text-body-sm text-sand-200 hover:text-sand-0 ${FOOTER_FOCUS}`}
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
              <li>
                <a
                  href={`${env.NEXT_PUBLIC_APP_URL}/login`}
                  className={`text-body-sm text-sand-200 hover:text-sand-0 ${FOOTER_FOCUS}`}
                >
                  Sign in
                </a>
              </li>
            </ul>
          </nav>

          <nav aria-label="Company">
            <h3 className="text-caption text-sand-400 font-semibold tracking-wide uppercase">
              Company
            </h3>
            <ul className="mt-4 space-y-3">
              {COMPANY_LINKS.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className={`text-body-sm text-sand-200 hover:text-sand-0 ${FOOTER_FOCUS}`}
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-label="Legal">
            <h3 className="text-caption text-sand-400 font-semibold tracking-wide uppercase">
              Legal
            </h3>
            <ul className="mt-4 space-y-3">
              {LEGAL_LINKS.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className={`text-body-sm text-sand-200 hover:text-sand-0 ${FOOTER_FOCUS}`}
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <div className="border-sand-700/60 text-sand-400 mt-12 border-t pt-6">
          <p className="text-caption">
            {/* Copyright year, not business logic — same exception as sitemap.ts (ADR-007). */}
            {/* eslint-disable-next-line no-restricted-syntax */}
            &copy; {new Date().getFullYear()} Healthy Aahar. Currently delivering in Noida, Uttar
            Pradesh.
          </p>
        </div>
      </Container>
    </footer>
  );
}
