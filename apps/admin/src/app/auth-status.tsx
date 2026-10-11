'use client';

import { ApiError, type AdminMe } from '@healthy-aahar/sdk';
import { Button } from '@healthy-aahar/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { apiClient } from '@/lib/api-client';

/** Reads the current admin session (PHASE 03) and offers sign-in/sign-out. */
export function AuthStatus() {
  const router = useRouter();
  const [me, setMe] = useState<AdminMe | null | 'loading'>('loading');

  useEffect(() => {
    let cancelled = false;
    apiClient
      .adminMe()
      .then((result) => {
        if (!cancelled) setMe(result);
      })
      .catch((err) => {
        if (cancelled) return;
        if (
          err instanceof ApiError &&
          (err.code === 'UNAUTHENTICATED' || err.code === 'SESSION_EXPIRED')
        ) {
          setMe(null);
        } else {
          setMe(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (me === 'loading') {
    return <p className="text-body-sm text-sand-400">Checking session…</p>;
  }

  if (!me) {
    return (
      <Button size="sm" variant="secondary" onClick={() => router.push('/login')}>
        Sign in
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <p className="text-body-sm text-sand-600">
        Signed in as <span className="text-sand-900 font-medium">{me.full_name}</span>
      </p>
      <Button
        size="sm"
        variant="ghost"
        onClick={async () => {
          await apiClient.adminLogout();
          router.push('/login');
          router.refresh();
        }}
      >
        Sign out
      </Button>
    </div>
  );
}
