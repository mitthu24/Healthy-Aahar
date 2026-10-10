'use client';

import type { AddressDto } from '@healthy-aahar/sdk';
import { Badge, Button, Card, EmptyState, ErrorState, Skeleton } from '@healthy-aahar/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { apiClient } from '@/lib/api-client';
import { getSessionToken } from '@/lib/session-store';
import { AddressForm } from '@/components/address-form';

export default function AddressesPage() {
  const router = useRouter();
  const [addresses, setAddresses] = useState<AddressDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<AddressDto | null>(null);

  async function load() {
    setError(null);
    try {
      const result = await apiClient.listAddresses();
      setAddresses(result.data);
    } catch {
      setError('Could not load your addresses.');
    }
  }

  useEffect(() => {
    if (!getSessionToken()) {
      router.replace(`/login?next=${encodeURIComponent('/addresses')}`);
      return;
    }
    void load();
  }, []);

  if (error) return <ErrorState message={error} onRetry={() => void load()} />;

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <div className="flex items-baseline justify-between">
        <h1 className="font-display text-heading-lg text-sand-900">Your addresses</h1>
        {!showForm ? (
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setShowForm(true);
            }}
          >
            Add new
          </Button>
        ) : null}
      </div>

      {showForm ? (
        <Card className="mt-5 p-4">
          <AddressForm
            initial={editing ?? undefined}
            onCancel={() => setShowForm(false)}
            onSaved={() => {
              setShowForm(false);
              void load();
            }}
          />
        </Card>
      ) : null}

      <div className="mt-5 space-y-3">
        {addresses === null ? (
          Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)
        ) : addresses.length === 0 && !showForm ? (
          <EmptyState title="No saved addresses" description="Add one to speed up checkout next time." />
        ) : (
          addresses.map((address) => (
            <Card key={address.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-body-sm text-sand-900 font-semibold">{address.recipient_name}</p>
                    {address.is_default ? <Badge tone="brand">Default</Badge> : null}
                    {!address.is_serviceable ? <Badge tone="warning">Not yet deliverable</Badge> : null}
                  </div>
                  <p className="text-body-sm text-sand-700 mt-1">
                    {address.line1}
                    {address.line2 ? `, ${address.line2}` : ''}, {address.city}, {address.state} {address.pincode}
                  </p>
                  <p className="text-caption text-sand-600 mt-1">{address.recipient_phone}</p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setEditing(address);
                    setShowForm(true);
                  }}
                >
                  Edit
                </Button>
              </div>
            </Card>
          ))
        )}
      </div>
    </main>
  );
}
