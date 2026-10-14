'use client';

import { ApiError, type AdminCustomerDetail } from '@healthy-aahar/sdk';
import { Badge, Button, Card, ErrorState, Skeleton } from '@healthy-aahar/ui';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { apiClient } from '@/lib/api-client';

const STATUS_TONE = { ACTIVE: 'success', SUSPENDED: 'warning', DEACTIVATED: 'danger' } as const;

export default function CustomerDetailPage() {
  const params = useParams<{ id: string }>();
  const [customer, setCustomer] = useState<AdminCustomerDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<{ email: string | null; phone: string | null } | null>(
    null,
  );
  const [revealError, setRevealError] = useState<string | null>(null);
  const [isRevealing, setIsRevealing] = useState(false);

  async function load() {
    setError(null);
    try {
      setCustomer(await apiClient.getAdminCustomer(params.id));
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'NOT_FOUND'
          ? 'Customer not found.'
          : 'Could not load this customer.',
      );
    }
  }

  useEffect(() => {
    void load();
  }, [params.id]);

  async function onReveal() {
    setRevealError(null);
    setIsRevealing(true);
    try {
      setRevealed(await apiClient.revealCustomerPii(params.id));
    } catch (err) {
      setRevealError(
        err instanceof ApiError && err.code === 'FORBIDDEN'
          ? "You don't have permission to reveal contact details."
          : 'Could not reveal contact details.',
      );
    } finally {
      setIsRevealing(false);
    }
  }

  if (error) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!customer) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-8">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mt-4 h-40 w-full" />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-8 pb-16">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-heading-lg text-sand-900">
            {customer.full_name ?? 'Unnamed customer'}
          </h1>
          <p className="text-body-sm text-sand-600 mt-1">
            {revealed?.email ?? customer.email ?? '—'}
            {(revealed?.phone ?? customer.phone) ? ` · ${revealed?.phone ?? customer.phone}` : ''}
          </p>
        </div>
        <Badge tone={STATUS_TONE[customer.status]}>{customer.status}</Badge>
      </div>

      {!revealed ? (
        <div className="mt-3">
          <Button size="sm" variant="secondary" isLoading={isRevealing} onClick={() => void onReveal()}>
            Reveal contact details
          </Button>
          {revealError ? <p className="text-caption text-danger-600 mt-2">{revealError}</p> : null}
        </div>
      ) : (
        <p className="text-caption text-sand-500 mt-2">
          Contact details revealed — this view was recorded in the audit log.
        </p>
      )}

      <div className="mt-6 grid grid-cols-3 gap-3">
        <Card className="p-4">
          <p className="text-caption text-sand-600 font-medium uppercase tracking-wide">
            Total orders
          </p>
          <p className="font-display text-heading-sm text-sand-900 mt-1">
            {customer.total_orders}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-caption text-sand-600 font-medium uppercase tracking-wide">
            Lifetime spend
          </p>
          <p className="font-display text-heading-sm text-sand-900 mt-1">
            {customer.lifetime_value.display}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-caption text-sand-600 font-medium uppercase tracking-wide">
            Last order
          </p>
          <p className="font-display text-heading-sm text-sand-900 mt-1">
            {customer.last_order_at
              ? new Date(customer.last_order_at).toLocaleDateString('en-IN')
              : 'Never'}
          </p>
        </Card>
      </div>

      <section className="mt-8">
        <h2 className="text-heading-sm text-sand-900">Recent orders</h2>
        <div className="mt-3 space-y-2">
          {customer.recent_orders.length === 0 ? (
            <Card className="p-5">
              <p className="text-body-sm text-sand-600">No orders yet.</p>
            </Card>
          ) : (
            customer.recent_orders.map((o) => (
              <a
                key={o.id}
                href={`/orders/${o.id}`}
                className="hover:border-green-300 flex items-center justify-between gap-2 rounded-md border border-sand-200 bg-sand-0 p-3 transition-colors"
              >
                <div>
                  <p className="text-body-sm text-sand-900 font-medium">{o.order_number}</p>
                  <p className="text-caption text-sand-500">
                    {new Date(o.placed_at).toLocaleDateString('en-IN')} · {o.status}
                  </p>
                </div>
                <span className="text-body-sm text-sand-900 font-medium">{o.total.display}</span>
              </a>
            ))
          )}
        </div>
      </section>
    </main>
  );
}
