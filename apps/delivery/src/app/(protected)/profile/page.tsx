'use client';

import { ApiError, type AdminMe } from '@healthy-aahar/sdk';
import { Button, Card, ErrorState, Skeleton } from '@healthy-aahar/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { apiClient } from '@/lib/api-client';

export default function ProfilePage() {
  const router = useRouter();
  const [me, setMe] = useState<AdminMe | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .adminMe()
      .then(setMe)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load profile.'));
  }, []);

  if (error) return <ErrorState message={error} />;
  if (!me) {
    return (
      <main className="mx-auto max-w-md px-5 py-8">
        <Skeleton className="h-32 w-full" />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md px-5 py-6">
      <h1 className="font-display text-heading-lg text-sand-900">Profile</h1>

      <Card className="mt-5 p-4">
        <p className="text-body-md text-sand-900 font-semibold">{me.full_name}</p>
        <p className="text-body-sm text-sand-600 mt-0.5">{me.email ?? 'No email on file'}</p>
      </Card>

      <Button
        variant="secondary"
        className="mt-6 w-full"
        onClick={async () => {
          await apiClient.adminLogout();
          router.push('/login');
          router.refresh();
        }}
      >
        Sign out
      </Button>
    </main>
  );
}
