'use client';

import { Skeleton } from '@healthy-aahar/ui';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { apiClient } from '@/lib/api-client';

/**
 * Client-side auth + authorization boundary for every protected route.
 *
 * Same cross-origin-cookie topology as apps/admin's `AuthGate` (this app and
 * the API are on different origins, so the check has to happen via a fetch
 * from this page's own JS, not edge middleware — see that component's doc
 * comment for the full explanation). The one addition here: a valid admin
 * session that LACKS `deliveries:fulfil` (an ordinary employee who isn't a
 * delivery partner, signed in by mistake) is treated the same as no session
 * at all — this app has nothing to show them. The API enforces this
 * independently on every route regardless of what this component decides to
 * render.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [status, setStatus] = useState<'checking' | 'authenticated' | 'redirecting'>('checking');
  const hasConfirmedOnce = useRef(false);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .adminMe()
      .then((me) => {
        if (cancelled) return;
        if (!me.permissions.includes('deliveries:fulfil')) {
          setStatus('redirecting');
          router.replace('/login');
          return;
        }
        hasConfirmedOnce.current = true;
        setStatus('authenticated');
      })
      .catch(() => {
        if (cancelled) return;
        setStatus('redirecting');
        router.replace('/login');
      });
    return () => {
      cancelled = true;
    };
  }, [router, pathname]);

  if (status !== 'authenticated' && !hasConfirmedOnce.current) {
    return (
      <main className="mx-auto max-w-md px-6 py-12">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mt-4 h-40 w-full" />
      </main>
    );
  }
  if (status === 'redirecting') {
    return null;
  }

  return <>{children}</>;
}
