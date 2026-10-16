'use client';

import type { AdminProductListResponse } from '@healthy-aahar/sdk';
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Input,
  Skeleton,
  type BadgeTone,
} from '@healthy-aahar/ui';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { apiClient } from '@/lib/api-client';

function statusTone(status: string): BadgeTone {
  switch (status) {
    case 'ACTIVE':
      return 'success';
    case 'DRAFT':
      return 'warning';
    case 'ARCHIVED':
      return 'danger';
    default:
      return 'neutral';
  }
}

const STATUS_FILTERS = [
  { value: undefined, label: 'All' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'ACTIVE', label: 'Published' },
  { value: 'INACTIVE', label: 'Unpublished' },
  { value: 'ARCHIVED', label: 'Archived' },
] as const;

export default function ProductsPage() {
  const [page, setPage] = useState<AdminProductListResponse | null>(null);
  const [status, setStatus] = useState<string | undefined>(undefined);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function load(q: string, s: string | undefined) {
    setError(null);
    setPage(null);
    try {
      setPage(await apiClient.listAdminProducts({ limit: 50, status: s, q: q || undefined }));
    } catch {
      setError('Could not load products.');
    }
  }

  // Debounced so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    void load(debouncedQuery, status);
  }, [status, debouncedQuery]);

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="font-display text-heading-lg text-sand-900">Products</h1>
        <Link href="/products/new">
          <Button size="sm">New product</Button>
        </Link>
      </div>

      <div className="mt-4">
        <Input
          type="search"
          placeholder="Search products by name…"
          aria-label="Search products"
          className="max-w-sm"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

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
        <ErrorState message={error} onRetry={() => void load(debouncedQuery, status)} />
      ) : page === null ? (
        <div className="mt-6 space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : page.data.length === 0 ? (
        <EmptyState
          title="No products match this filter"
          action={
            <Link href="/products/new">
              <Button>Create your first product</Button>
            </Link>
          }
        />
      ) : (
        <div className="border-sand-200 mt-6 overflow-hidden rounded-lg border">
          <table className="w-full text-left">
            <thead className="bg-sand-50 text-caption text-sand-600">
              <tr>
                <th className="px-4 py-2">Product</th>
                <th className="px-4 py-2">Category</th>
                <th className="px-4 py-2">Variants</th>
                <th className="px-4 py-2">From price</th>
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-sand-100 divide-y">
              {page.data.map((product) => (
                <tr key={product.id} className="hover:bg-sand-50">
                  <td className="p-0">
                    <Link
                      href={`/products/${product.id}`}
                      className="text-body-sm block px-4 py-3 font-medium text-green-700"
                    >
                      {product.name}
                    </Link>
                  </td>
                  <td className="text-body-sm text-sand-700 px-4 py-3">{product.category.name}</td>
                  <td className="text-body-sm text-sand-700 px-4 py-3">{product.variant_count}</td>
                  <td className="text-body-sm tabular px-4 py-3">
                    {product.from_price?.display ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={statusTone(product.status)}>{product.status}</Badge>
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
