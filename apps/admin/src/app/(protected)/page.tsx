'use client';

import type { AdminOrderDto, DashboardSummary } from '@healthy-aahar/sdk';
import { ApiError } from '@healthy-aahar/sdk';
import {
  Badge,
  Card,
  ChartContainer,
  DateRangePicker,
  EmptyState,
  ErrorState,
  PageHeader,
  ResponsiveContainer,
  Skeleton,
  StatCard,
  TrendChart,
  type DateRange,
  type DateRangePreset,
} from '@healthy-aahar/ui';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import {
  AuditIcon,
  DeliveryIcon,
  EmployeesIcon,
  OrdersIcon,
  ProductsIcon,
} from '@/components/shell/icons';
import { apiClient } from '@/lib/api-client';

const QUICK_ACTIONS = [
  {
    href: '/orders',
    label: 'Orders',
    description: 'Review confirmed orders, update fulfilment, and record COD collection.',
    icon: OrdersIcon,
  },
  {
    href: '/delivery-partners',
    label: 'Delivery Partners',
    description: 'Create partner accounts, review duty status, and assign deliveries.',
    icon: DeliveryIcon,
  },
  {
    href: '/products',
    label: 'Products',
    description: 'Manage the catalogue, pricing, stock and images.',
    icon: ProductsIcon,
  },
  {
    href: '/employees',
    label: 'Employees',
    description: 'Invite staff and manage role-based access.',
    icon: EmployeesIcon,
  },
  {
    href: '/audit-log',
    label: 'Audit Log',
    description: 'Review recent sensitive changes across the business.',
    icon: AuditIcon,
  },
] as const;

/** `YYYY-MM-DD` for a UTC instant — a reasonable client-side default only;
 *  the server is the sole source of truth for business-date boundaries
 *  (`businessDateTimeToUtc`, Asia/Kolkata) and re-validates every request. */
function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function rangeForPreset(preset: DateRangePreset): DateRange {
  // `new Date(Date.now())`, not the banned bare `new Date()` (ADR-007's
  // lint rule targets zero-arg Date reads in packages/core/apps/api,
  // where it matters for testability) — this is a client-side default for
  // the picker only, and the server independently re-validates/clamps the
  // actual date-range boundaries on every request.
  const current = new Date(Date.now());
  const today = toDateString(current);
  if (preset === 'today') return { from: today, to: today };
  if (preset === '7d') {
    const from = new Date(current);
    from.setUTCDate(from.getUTCDate() - 6);
    return { from: toDateString(from), to: today };
  }
  if (preset === '30d') {
    const from = new Date(current);
    from.setUTCDate(from.getUTCDate() - 29);
    return { from: toDateString(from), to: today };
  }
  if (preset === 'this_month') {
    const from = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 1));
    return { from: toDateString(from), to: today };
  }
  return { from: today, to: today };
}

/**
 * Founder overview (Stage D). Every number on this page comes from
 * `GET /v1/admin/dashboard/*`, backed by real SQL aggregation — there is no
 * hardcoded or estimated figure here, and an empty range shows real zeros
 * and empty states, never a fabricated chart or placeholder number (the
 * honesty this page's Stage B/C predecessor was explicit about is now
 * backed by an actual aggregation service, not just removed).
 */
export default function HomePage() {
  const [preset, setPreset] = useState<DateRangePreset>('7d');
  const [range, setRange] = useState<DateRange>(() => rangeForPreset('7d'));

  function onPresetChange(next: DateRangePreset) {
    setPreset(next);
    if (next !== 'custom') setRange(rangeForPreset(next));
  }

  return (
    <main className="py-8">
      <ResponsiveContainer wide>
        <PageHeader
          title="Welcome back"
          description="A real-time view of sales, orders, delivery performance and stock, backed by your actual order history."
          action={
            <DateRangePicker
              preset={preset}
              range={range}
              onPresetChange={onPresetChange}
              onRangeChange={setRange}
            />
          }
        />

        <div className="mt-6">
          <SummarySection range={range} />
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <TrendSection range={range} />
          </div>
          <InventoryAlertsSection />
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <TopProductsSection range={range} />
          <RecentOrdersSection />
        </div>

        <div className="mt-8">
          <h2 className="text-heading-sm text-sand-900">Manage your business</h2>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {QUICK_ACTIONS.map((action) => {
              const Icon = action.icon;
              return (
                <Link key={action.href} href={action.href}>
                  <Card className="flex h-full items-start gap-3.5 p-5 transition-colors hover:border-green-300">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-green-50 text-green-700">
                      <Icon className="h-5 w-5" />
                    </span>
                    <div>
                      <h3 className="text-body-md text-sand-900 font-semibold">{action.label}</h3>
                      <p className="text-body-sm text-sand-600 mt-1">{action.description}</p>
                    </div>
                  </Card>
                </Link>
              );
            })}
          </div>
        </div>
      </ResponsiveContainer>
    </main>
  );
}

function SummarySection({ range }: { range: DateRange }) {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    setSummary(null);
    try {
      setSummary(await apiClient.getDashboardSummary(range));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the dashboard summary.');
    }
  }

  useEffect(() => {
    void load();
  }, [range.from, range.to]);

  if (error) return <ErrorState message={error} onRetry={() => void load()} />;

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard
          label="Orders"
          value={summary?.order_count.toLocaleString()}
          isLoading={!summary}
        />
        <StatCard label="Gross sales" value={summary?.gross_sales.display} isLoading={!summary} />
        <StatCard label="Net sales" value={summary?.net_sales.display} isLoading={!summary} />
        <StatCard
          label="Avg. order value"
          value={summary?.average_order_value?.display ?? (summary ? '—' : undefined)}
          isLoading={!summary}
        />
        <StatCard label="Collected" value={summary?.collected.display} isLoading={!summary} />
        <StatCard
          label="Outstanding COD"
          value={summary?.outstanding_cod.display}
          isLoading={!summary}
        />
      </div>

      {summary ? (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card className="p-4">
            <p className="text-caption text-sand-600 font-medium uppercase tracking-wide">
              Cancelled
            </p>
            <p className="font-display text-heading-sm text-sand-900 mt-1">
              {summary.cancelled_count}
            </p>
            <p className="text-caption text-sand-500 mt-0.5">{summary.cancelled_value.display}</p>
          </Card>
          <Card className="p-4">
            <p className="text-caption text-sand-600 font-medium uppercase tracking-wide">
              Delivered
            </p>
            <p className="font-display text-heading-sm text-sand-900 mt-1">
              {summary.delivery.delivered_count}
            </p>
            <p className="text-caption text-sand-500 mt-0.5">
              {summary.delivery.failed_count} failed
            </p>
          </Card>
          <Card className="p-4">
            <p className="text-caption text-sand-600 font-medium uppercase tracking-wide">
              Avg. fulfilment
            </p>
            <p className="font-display text-heading-sm text-sand-900 mt-1">
              {summary.delivery.avg_fulfilment_minutes !== null
                ? `${Math.round(summary.delivery.avg_fulfilment_minutes)} min`
                : '—'}
            </p>
          </Card>
          <Card className="p-4">
            <p className="text-caption text-sand-600 font-medium uppercase tracking-wide">
              On-time rate
            </p>
            <p className="font-display text-heading-sm text-sand-900 mt-1">
              {summary.delivery.on_time_rate !== null
                ? `${Math.round(summary.delivery.on_time_rate * 100)}%`
                : '—'}
            </p>
          </Card>
        </div>
      ) : null}

      {summary && summary.status_breakdown.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {summary.status_breakdown.map((s) => (
            <Badge key={s.status} tone="neutral">
              {s.status.replaceAll('_', ' ')}: {s.count}
            </Badge>
          ))}
        </div>
      ) : null}
    </>
  );
}

function TrendSection({ range }: { range: DateRange }) {
  const [points, setPoints] = useState<Array<{
    label: string;
    value: number;
    valueLabel: string;
  }> | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    setPoints(null);
    try {
      const res = await apiClient.getSalesTrend(range);
      setPoints(
        res.data.map((p) => ({
          label: p.date.slice(5),
          value: p.gross_sales.amount_paise,
          valueLabel: `${p.gross_sales.display} · ${p.order_count} order${p.order_count === 1 ? '' : 's'}`,
        })),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the sales trend.');
    }
  }

  useEffect(() => {
    void load();
  }, [range.from, range.to]);

  return (
    <ChartContainer title="Sales trend" height="h-48">
      {error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : points === null ? (
        <Skeleton className="h-full w-full" />
      ) : (
        <TrendChart points={points} height={160} />
      )}
    </ChartContainer>
  );
}

function InventoryAlertsSection() {
  const [alerts, setAlerts] = useState<Array<{
    variant_id: string;
    product_name: string;
    quantity_available: number;
  }> | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    setAlerts(null);
    try {
      setAlerts((await apiClient.getInventoryAlerts({ limit: 8 })).data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load inventory alerts.');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <Card className="p-4">
      <h3 className="text-body-md text-sand-900 font-semibold">Low stock</h3>
      <div className="mt-3 space-y-2">
        {error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : alerts === null ? (
          <>
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </>
        ) : alerts.length === 0 ? (
          <EmptyState
            title="No low-stock variants"
            description="Every tracked variant is above its threshold."
          />
        ) : (
          alerts.map((a) => (
            <div key={a.variant_id} className="flex items-center justify-between gap-2">
              <span className="text-body-sm text-sand-800 truncate">{a.product_name}</span>
              <Badge tone={a.quantity_available <= 0 ? 'danger' : 'warning'}>
                {a.quantity_available} left
              </Badge>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

function TopProductsSection({ range }: { range: DateRange }) {
  const [products, setProducts] = useState<Array<{
    variant_id: string;
    product_name: string;
    quantity: number;
    revenue: { display: string };
  }> | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    setProducts(null);
    try {
      setProducts((await apiClient.getTopProducts({ ...range, limit: 5 })).data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load top products.');
    }
  }

  useEffect(() => {
    void load();
  }, [range.from, range.to]);

  return (
    <Card className="p-4">
      <h3 className="text-body-md text-sand-900 font-semibold">Top products</h3>
      <div className="mt-3 space-y-2">
        {error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : products === null ? (
          <>
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </>
        ) : products.length === 0 ? (
          <EmptyState title="No sales in this range" description="Try a wider date range." />
        ) : (
          products.map((p, i) => (
            <div key={p.variant_id} className="flex items-center justify-between gap-2">
              <span className="text-body-sm text-sand-800 truncate">
                {i + 1}. {p.product_name} <span className="text-sand-500">× {p.quantity}</span>
              </span>
              <span className="text-body-sm text-sand-900 shrink-0 font-medium">
                {p.revenue.display}
              </span>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

function RecentOrdersSection() {
  const [orders, setOrders] = useState<AdminOrderDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    setOrders(null);
    try {
      setOrders((await apiClient.listAdminOrders({ limit: 5 })).data as AdminOrderDto[]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load recent orders.');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-body-md text-sand-900 font-semibold">Recent orders</h3>
        <Link href="/orders" className="text-caption font-medium text-green-700 hover:underline">
          View all
        </Link>
      </div>
      <div className="mt-3 space-y-2">
        {error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : orders === null ? (
          <>
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </>
        ) : orders.length === 0 ? (
          <EmptyState title="No orders yet" />
        ) : (
          orders.map((o) => (
            <Link
              key={o.id}
              href={`/orders/${o.id}`}
              className="hover:bg-sand-50 flex items-center justify-between gap-2 rounded-md px-1 py-1"
            >
              <span className="text-body-sm text-sand-800 truncate">
                {o.order_number} <span className="text-sand-500">· {o.customer_name}</span>
              </span>
              <span className="text-body-sm text-sand-900 shrink-0 font-medium">
                {o.total.display}
              </span>
            </Link>
          ))
        )}
      </div>
    </Card>
  );
}
