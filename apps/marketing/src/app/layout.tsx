import type { Metadata, Viewport } from 'next';
import { Fraunces, Inter } from 'next/font/google';

import { AnnouncementBar } from '@/components/announcement-bar';
import { Footer } from '@/components/footer';
import { Navbar } from '@/components/navbar';
import { env } from '@/lib/env';

import './globals.css';

const siteUrl = env.NEXT_PUBLIC_MARKETING_URL;

// Self-hosted by Next.js's built-in font optimization (no third-party
// request, font-display: swap by default) — docs/16-MARKETING-WEBSITE.md §8.
// Exposed as CSS variables and wired into this app's own Tailwind config
// (apps/marketing/tailwind.config.ts) rather than the shared preset, so
// apps/admin and apps/customer are unaffected.
const fraunces = Fraunces({
  subsets: ['latin'],
  weight: ['500', '600'],
  variable: '--font-fraunces',
  display: 'swap',
});
const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'Healthy Aahar — Fresh, Healthy Food Delivered Daily in Noida',
    template: '%s · Healthy Aahar',
  },
  description:
    'Fresh fruit, salads, sprouts and healthy meals, prepared the same day and delivered to your door in Noida — in a morning or evening slot you choose.',
  openGraph: {
    type: 'website',
    siteName: 'Healthy Aahar',
    locale: 'en_IN',
    url: siteUrl,
    title: 'Healthy Aahar — Fresh, Healthy Food Delivered Daily in Noida',
    description:
      'Fresh fruit, salads, sprouts and healthy meals, prepared the same day and delivered to your door in Noida.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Healthy Aahar — Fresh, Healthy Food Delivered Daily in Noida',
    description:
      'Fresh fruit, salads, sprouts and healthy meals, prepared the same day and delivered to your door in Noida.',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#143C26',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" className={`${fraunces.variable} ${inter.variable}`}>
      <body className="bg-sand-50 font-body text-sand-800 min-h-dvh antialiased">
        <a
          href="#main-content"
          className="text-sand-0 sr-only bg-green-700 focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:px-4 focus:py-2 focus-visible:outline-none"
        >
          Skip to content
        </a>
        <AnnouncementBar />
        <Navbar />
        <main id="main-content">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
