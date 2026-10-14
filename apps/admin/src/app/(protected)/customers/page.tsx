'use client';

import type { AdminCustomer } from '@healthy-aahar/sdk';
import {
  Badge,
  Button,
  DataTable,
  type DataTableColumn,
  type PaginationMeta,
  Pagination,
  PageHeader,
  ResponsiveContainer,
  SearchInput,
  Select,
} from '@healthy-aahar/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { apiClient } from '@/lib/api-client';

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'SUSPENDED', label: 'Suspended' },
  { value: 'DEACTIVATED', label: 'Deactivated' },
];

/**
 * Founder customer directory (Stage E). `email`/`phone` here are always
 * MASKED — the API never returns real contact details from this list, only
 * from the explicit, audited "reveal" action on a customer's own detail
 * page. `total_orders`/`lifetime_value` are computed live server-side from
 * real (non-cancelled) orders, never a placeholder.
 */
export default function CustomersPage() {
  const router = useRouter();
  const [customers, setCustomers] = useState<AdminCustomer[] | null>(null);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  async function load(query: string, statusFilter: string) {
    setError(null);
    try {
      const res = await apiClient.listAdminCustomers({
        q: query || undefined,
        status: statusFilter || undefined,
      });
      setCustomers(res.data);
      setPagination(res.pagination);
    } catch {
      setError('Could not load customers.');
    }
  }

  async function loadMore() {
    if (!pagination?.next_cursor || !customers) return;
    setIsLoadingMore(true);
    try {
      const res = await apiClient.listAdminCustomers({
        q: q || undefined,
        status: status || undefined,
        cursor: pagination.next_cursor,
      });
      setCustomers([...customers, ...res.data]);
      setPagination(res.pagination);
    } catch {
      setError('Could not load more customers.');
    } finally {
      setIsLoadingMore(false);
    }
  }

  useEffect(() => {
    const id = setTimeout(() => void load(q, status), 250);
    return () => clearTimeout(id);
  }, [q, status]);

  const columns: DataTableColumn<AdminCustomer>[] = [
    {
      key: 'name',
      header: 'Customer',
      render: (c) => (
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sand-900 font-semibold">{c.full_name ?? 'Unnamed'}</span>
            {c.status !== 'ACTIVE' ? (
              <Badge tone={c.status === 'SUSPENDED' ? 'warning' : 'danger'}>
                {c.status === 'SUSPENDED' ? 'Suspended' : 'Deactivated'}
              </Badge>
            ) : null}
          </div>
          <p className="text-caption text-sand-600 mt-0.5">
            {c.email ?? '—'}
            {c.phone ? ` · ${c.phone}` : ''}
          </p>
        </div>
      ),
    },
    {
      key: 'orders',
      header: 'Orders',
      align: 'right',
      hideOnMobile: true,
      render: (c) => <span className="text-sand-800">{c.total_orders}</span>,
    },
    {
      key: 'spend',
      header: 'Lifetime spend',
      align: 'right',
      render: (c) => <span className="text-sand-900 font-medium">{c.lifetime_value.display}</span>,
    },
    {
      key: 'last_order',
      header: 'Last order',
      align: 'right',
      hideOnMobile: true,
      render: (c) => (
        <span className="text-sand-600">
          {c.last_order_at ? new Date(c.last_order_at).toLocaleDateString('en-IN') : 'Never'}
        </span>
      ),
    },
  ];

  return (
    <main className="py-8">
      <ResponsiveContainer wide>
        <PageHeader
          title="Customers"
          description="Your customer base — search, filter and open a customer to see their order history."
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                window.open(
                  apiClient.adminCustomersExportCsvUrl({
                    q: q || undefined,
                    status: status || undefined,
                  }),
                  '_blank',
                );
              }}
            >
              Export CSV
            </Button>
          }
        />

        <div className="mt-5 flex flex-wrap items-end gap-3">
          <div className="max-w-xs flex-1">
            <SearchInput
              placeholder="Search by name, email or phone"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              label="Search customers"
            />
          </div>
          <div className="w-44">
            <Select
              aria-label="Filter by status"
              value={status}
              options={STATUS_OPTIONS}
              onChange={(e) => setStatus(e.target.value)}
            />
          </div>
        </div>

        <div className="mt-6">
          <DataTable
            columns={columns}
            data={customers}
            rowKey={(c) => c.id}
            error={error}
            onRetry={() => void load(q, status)}
            emptyTitle="No customers found"
            emptyDescription={q || status ? 'Try a different search or filter.' : 'No customers have placed an order yet.'}
            onRowClick={(c) => router.push(`/customers/${c.id}`)}
          />
          {pagination ? (
            <div className="mt-4">
              <Pagination pagination={pagination} onLoadMore={() => void loadMore()} isLoading={isLoadingMore} />
            </div>
          ) : null}
        </div>
      </ResponsiveContainer>
    </main>
  );
}
