'use client';

import { Button, Card } from '@healthy-aahar/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { apiClient } from '@/lib/api-client';
import { getSessionToken, setSessionToken } from '@/lib/session-store';

const LINKS = [
  { href: '/orders', label: 'My orders', description: 'Track and review past orders' },
  { href: '/addresses', label: 'Addresses', description: 'Manage delivery addresses' },
];

export default function AccountPage() {
  const router = useRouter();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    setSignedIn(Boolean(getSessionToken()));
  }, []);

  if (signedIn === false) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10 text-center">
        <p className="text-body-md text-sand-700">Sign in to view your account.</p>
        <Link href={`/login?next=${encodeURIComponent('/account')}`}>
          <Button className="mt-4">Sign in</Button>
        </Link>
      </main>
    );
  }

  if (signedIn === null) return null;

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="font-display text-heading-lg text-sand-900">Account</h1>

      <div className="mt-5 space-y-3">
        {LINKS.map((link) => (
          <Link key={link.href} href={link.href}>
            <Card className="flex items-center justify-between p-4 hover:bg-sand-50">
              <div>
                <p className="text-body-sm text-sand-900 font-medium">{link.label}</p>
                <p className="text-caption text-sand-600">{link.description}</p>
              </div>
              <span aria-hidden className="text-sand-400">
                →
              </span>
            </Card>
          </Link>
        ))}
      </div>

      <Button
        variant="secondary"
        className="mt-8 w-full"
        onClick={async () => {
          await apiClient.customerLogout().catch(() => undefined);
          setSessionToken(null);
          router.push('/login');
        }}
      >
        Sign out
      </Button>
    </main>
  );
}
