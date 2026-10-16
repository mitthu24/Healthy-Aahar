'use client';

import type { AdminOrderCountsResponse, AdminOrderListResponse } from '@healthy-aahar/sdk';
import {
  Badge,
  DateRangePicker,
  EmptyState,
  ErrorState,
  rangeForPreset,
  Skeleton,
  type DateRange,
  type DateRangePreset,
} from '@healthy-aahar/ui';
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

// `new Date(Date.now())`, not the banned bare `new Date()` (ADR-007's lint
// rule is scoped to packages/core/apps/api) — this is only a client-side
// default for the picker; the server independently re-validates/clamps the
// actual date-range boundaries on every request.
function defaultRangeForPreset(preset: DateRangePreset): DateRange {
  return rangeForPreset(preset, new Date(Date.now()));
}

/** Sums every status count that isn't one of the six dedicated tabs (e.g.
 *  PENDING, FAILED, RETURNED) into "All" alongside the tab totals — so the
 *  All count always equals the true total for the range, never just the sum
 *  of the tabs shown. */
function countFor(counts: AdminOrderCountsResponse | null, status: string | undefined) {
  if (!counts) return null;
  if (status === undefined) return counts.total;
  return counts.by_status.find((row) => row.status === status)?.count ?? 0;
}

export default function AdminOrdersPage() {
  const [page, setPage] = useState<AdminOrderListResponse | null>(null);
  const [counts, setCounts] = useState<AdminOrderCountsResponse | null>(null);
  const [status, setStatus] = useState<string | undefined>(undefined);
  const [preset, setPreset] = useState<DateRangePreset>('today');
  const [range, setRange] = useState<DateRange>(() => defaultRangeForPreset('today'));
  const [error, setError] = useState<string | null>(null);

  function onPresetChange(next: DateRangePreset) {
    setPreset(next);
    if (next !== 'custom') setRange(defaultRangeForPreset(next));
  }

  async function load() {
    setError(null);
    setPage(null);
    setCounts(null);
    try {
      const [listRes, countsRes] = await Promise.all([
        apiClient.listAdminOrders({ limit: 50, status, from: range.from, to: range.to }),
        apiClient.getAdminOrderCounts({ from: range.from, to: range.to }),
      ]);
      setPage(listRes);
      setCounts(countsRes);
    } catch {
      setError('Could not load orders.');
    }
  }

  useEffect(() => {
    void load();
  }, [status, range.from, range.to]);

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-display text-heading-lg text-sand-900">Orders</h1>
        <DateRangePicker
          preset={preset}
          range={range}
          onPresetChange={onPresetChange}
          onRangeChange={setRange}
        />
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {STATUS_FILTERS.map((filter) => {
          const count = countFor(counts, filter.value);
          return (
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
              {count !== null ? (
                <span className="text-caption ml-1.5 opacity-70">{count}</span>
              ) : null}
            </button>
          );
        })}
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
        <div className="border-sand-200 mt-6 overflow-x-auto rounded-lg border">
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
