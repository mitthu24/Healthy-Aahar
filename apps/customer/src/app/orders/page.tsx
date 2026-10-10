'use client';

import type { OrderListResponse } from '@healthy-aahar/sdk';
import { Badge, Button, EmptyState, ErrorState, Skeleton, orderStatusTone } from '@healthy-aahar/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { apiClient } from '@/lib/api-client';
import { getSessionToken } from '@/lib/session-store';

export default function OrdersPage() {
  const router = useRouter();
  const [page, setPage] = useState<OrderListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      setPage(await apiClient.listMyOrders({ limit: 20 }));
    } catch {
      setError('Could not load your orders.');
    }
  }

  useEffect(() => {
    if (!getSessionToken()) {
      router.replace(`/login?next=${encodeURIComponent('/orders')}`);
      return;
    }
    void load();
  }, []);

  if (error) return <ErrorState message={error} onRetry={() => void load()} />;

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="font-display text-heading-lg text-sand-900">My orders</h1>

      <div className="mt-5 space-y-3">
        {page === null ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)
        ) : page.data.length === 0 ? (
          <EmptyState
            title="No orders yet"
            description="Your past orders will show up here."
            action={
              <Link href="/products">
                <Button>Start shopping</Button>
              </Link>
            }
          />
        ) : (
          page.data.map((order) => (
            <Link
              key={order.id}
              href={`/orders/${order.id}`}
              className="border-sand-200 flex items-center justify-between rounded-lg border p-4"
            >
              <div>
                <p className="text-body-sm text-sand-900 font-semibold">{order.order_number}</p>
                <p className="text-caption text-sand-600 mt-0.5">
                  {new Date(order.placed_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                  {' · '}
                  {order.item_count} item{order.item_count === 1 ? '' : 's'}
                </p>
              </div>
              <div className="text-right">
                <p className="text-body-sm tabular text-sand-900 font-semibold">{order.total.display}</p>
                <Badge tone={orderStatusTone(order.display_status)} className="mt-1">
                  {order.display_status}
                </Badge>
              </div>
            </Link>
          ))
        )}
      </div>
    </main>
  );
}
