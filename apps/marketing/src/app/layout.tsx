import type { Metadata, Viewport } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: 'Healthy Aahar — Fresh Fruits, Salads & Healthy Food Delivered Daily',
  description:
    'Fresh fruit, salads, sprouts and healthy meals delivered to your door in a guaranteed morning or evening slot.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#2E8B57',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body className="bg-sand-50 font-body text-sand-800 min-h-dvh antialiased">{children}</body>
    </html>
  );
}
