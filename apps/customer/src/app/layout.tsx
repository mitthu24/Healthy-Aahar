import type { Metadata, Viewport } from 'next';

import { BottomNav } from '@/components/bottom-nav';
import { Header } from '@/components/header';
import { SessionBootstrap } from '@/components/session-bootstrap';
import { readSessionCookie } from '@/lib/session-cookie';

import './globals.css';

export const metadata: Metadata = {
  title: 'Healthy Aahar',
  description: 'Order fresh, healthy food for your chosen delivery slot.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#2E8B57',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const initialToken = await readSessionCookie();

  return (
    <html lang="en-IN">
      <body className="bg-sand-50 font-body text-sand-800 min-h-dvh antialiased">
        <SessionBootstrap initialToken={initialToken} />
        <Header />
        <div className="pb-16 md:pb-0">{children}</div>
        <BottomNav />
      </body>
    </html>
  );
}
