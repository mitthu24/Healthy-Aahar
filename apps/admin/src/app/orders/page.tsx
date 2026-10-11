'use client';

import type { AdminOrderListResponse } from '@healthy-aahar/sdk';
import { Badge, EmptyState, ErrorState, Skeleton } from '@healthy-aahar/ui';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { apiClient } from '@/lib/api-client';
import { adminStatusTone } from '@/lib/order-status';

const STATUS_FILTERS = [
  { value: undefined, label: 'All' },
  { value: 'CONFIRMED', label: 'Confirmed' },
  { value: 'PREPARING', label: 'Preparing' },
  { value: 'READY_FOR_DISPATCH', label: 'Ready for dispatch' },
  { value: 'OUT_FOR_DELIVERY', label: 'Out for delivery' },
  { value: 'DELIVERED', label: 'Delivered' },
  { value: 'CANCELLED', label: 'Cancelled / rejected' },
] as const;

export default function AdminOrdersPage() {
  const [page, setPage] = useState<AdminOrderListResponse | null>(null);
  const [status, setStatus] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    setPage(null);
    try {
      setPage(await apiClient.listAdminOrders({ limit: 50, status }));
    } catch {
      setError('Could not load orders.');
    }
  }

  useEffect(() => {
    void load();
  }, [status]);

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="font-display text-heading-lg text-sand-900">Orders</h1>

      <div className="mt-5 flex flex-wrap gap-2">
        {STATUS_FILTERS.map((filter) => (
          <button
            key={filter.label}
            type="button"
            onClick={() => setStatus(filter.value)}
            className={`text-body-sm min-h-9 rounded-full border px-3 ${
              status === filter.value
                ? 'border-green-600 bg-green-50 text-green-700'
                : 'border-sand-200 text-sand-700'
            }`}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : page === null ? (
        <div className="mt-6 space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : page.data.length === 0 ? (
        <EmptyState title="No orders match this filter" />
      ) : (
        <div className="border-sand-200 mt-6 overflow-hidden rounded-lg border">
          <table className="w-full text-left">
            <thead className="bg-sand-50 text-caption text-sand-600">
              <tr>
                <th className="px-4 py-2">Order</th>
                <th className="px-4 py-2">Customer</th>
                <th className="px-4 py-2">Date</th>
                <th className="px-4 py-2">Total</th>
                <th className="px-4 py-2">Payment</th>
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-sand-100 divide-y">
              {page.data.map((order) => (
                <tr key={order.id} className="hover:bg-sand-50">
                  <td className="p-0">
                    <Link
                      href={`/orders/${order.id}`}
                      className="text-body-sm block px-4 py-3 font-medium text-green-700"
                    >
                      {order.order_number}
                    </Link>
                  </td>
                  <td className="text-body-sm text-sand-700 px-4 py-3">{order.customer_name}</td>
                  <td className="text-body-sm text-sand-700 px-4 py-3">
                    {new Date(order.placed_at).toLocaleDateString('en-IN', {
                      day: 'numeric',
                      month: 'short',
                    })}
                  </td>
                  <td className="text-body-sm tabular px-4 py-3">{order.total.display}</td>
                  <td className="px-4 py-3">
                    <Badge tone={order.payment_status === 'PAID' ? 'success' : 'neutral'}>
                      {order.payment_method} ·{' '}
                      {order.payment_status === 'PAID' ? 'Collected' : 'Due'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={adminStatusTone(order.status)}>
                      {order.status.replaceAll('_', ' ')}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
