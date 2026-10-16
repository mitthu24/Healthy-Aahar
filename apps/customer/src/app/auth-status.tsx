'use client';

import { Button } from '@healthy-aahar/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { apiClient } from '@/lib/api-client';
import { clearPersistedSessionToken } from '@/lib/session-client';
import { getSessionToken, subscribeSessionToken } from '@/lib/session-store';

/** Reads the in-memory session token (PHASE 03) and offers sign-in/sign-out. */
export function AuthStatus() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    setToken(getSessionToken());
    return subscribeSessionToken(() => setToken(getSessionToken()));
  }, []);

  if (!token) {
    return (
      <Button size="sm" variant="secondary" onClick={() => router.push('/login')}>
        Sign in
      </Button>
    );
  }

  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={async () => {
        await apiClient.customerLogout().catch(() => undefined);
        clearPersistedSessionToken();
        router.push('/login');
      }}
    >
      Sign out
    </Button>
  );
}
