'use client';

import { ApiError, type DeliveryOrderListResponse } from '@healthy-aahar/sdk';
import { Badge, Card, EmptyState, ErrorState, orderStatusTone, Skeleton } from '@healthy-aahar/ui';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { apiClient } from '@/lib/api-client';

const FILTERS = [
  { value: '', label: 'All' },
  { value: 'READY_FOR_DISPATCH', label: 'Awaiting pickup' },
  { value: 'OUT_FOR_DELIVERY', label: 'Out for delivery' },
  { value: 'DELIVERED', label: 'Delivered' },
  { value: 'FAILED', label: 'Failed' },
] as const;

function displayLabel(status: string): string {
  switch (status) {
    case 'READY_FOR_DISPATCH':
      return 'Awaiting pickup';
    case 'OUT_FOR_DELIVERY':
      return 'Out for delivery';
    case 'DELIVERED':
      return 'Delivered';
    case 'FAILED':
      return 'Delivery failed';
    default:
      return status;
  }
}

export default function MyDeliveriesPage() {
  const [page, setPage] = useState<DeliveryOrderListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('');

  async function load(status: string) {
    setError(null);
    try {
      setPage(await apiClient.listMyDeliveries({ status: status || undefined, limit: 50 }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your deliveries.');
    }
  }

  useEffect(() => {
    setPage(null);
    void load(filter);
  }, [filter]);

  if (error) return <ErrorState message={error} onRetry={() => void load(filter)} />;

  return (
    <main className="mx-auto max-w-md px-5 py-6">
      <h1 className="font-display text-heading-lg text-sand-900">My deliveries</h1>

      <div className="scrollbar-none mt-4 flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`text-caption shrink-0 rounded-full px-3 py-1.5 font-medium ${
              filter === f.value ? 'bg-green-600 text-white' : 'bg-sand-100 text-sand-700'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="mt-4 space-y-3">
        {page === null ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)
        ) : page.data.length === 0 ? (
          <EmptyState title="No deliveries here" description="Nothing in this filter right now." />
        ) : (
          page.data.map((order) => (
            <Link key={order.id} href={`/orders/${order.id}`}>
              <Card className="p-4 transition-colors active:border-green-300">
                <div className="flex items-center justify-between">
                  <p className="text-body-sm text-sand-900 font-semibold">{order.order_number}</p>
                  <Badge tone={orderStatusTone(displayLabel(order.status))}>
                    {displayLabel(order.status)}
                  </Badge>
                </div>
                <p className="text-body-sm text-sand-700 mt-1">{order.recipient_name}</p>
                <p className="text-caption text-sand-600 mt-1">
                  {order.delivery_address.line1}, {order.delivery_address.city}
                </p>
                <p className="text-caption text-sand-500 mt-1">
                  {order.service_date} · {order.slot_name}
                </p>
              </Card>
            </Link>
          ))
        )}
      </div>
    </main>
  );
}
