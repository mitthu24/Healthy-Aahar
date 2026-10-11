'use client';

import type { ProductListResponse } from '@healthy-aahar/sdk';
import { Button, EmptyState, ErrorState, Skeleton } from '@healthy-aahar/ui';
import { useCallback, useEffect, useState } from 'react';

import { apiClient } from '@/lib/api-client';

import { ProductCard } from './product-card';

function GridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex flex-col gap-2">
          <Skeleton className="aspect-square w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ))}
    </div>
  );
}

/** Catalogue grid with cursor pagination ("Load more"), used by Home, catalogue, category and search pages. */
export function ProductGrid({
  categoryId,
  q,
  emptyTitle = 'No products found',
  emptyDescription,
}: {
  categoryId?: string;
  q?: string;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  const [page, setPage] = useState<ProductListResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (cursor?: string) => {
      setError(null);
      try {
        const result = await apiClient.listProducts({
          category_id: categoryId,
          q,
          cursor,
          limit: 20,
        });
        setPage((prev) =>
          cursor && prev
            ? { data: [...prev.data, ...result.data], pagination: result.pagination }
            : result,
        );
      } catch {
        setError('Could not load products. Check your connection and try again.');
      }
    },
    [categoryId, q],
  );

  useEffect(() => {
    setIsLoading(true);
    setPage(null);
    void load().finally(() => setIsLoading(false));
  }, [load]);

  if (isLoading) return <GridSkeleton />;
  if (error) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!page || page.data.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {page.data.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>

      {page.pagination.has_more ? (
        <div className="mt-6 flex justify-center">
          <Button
            variant="secondary"
            isLoading={isLoadingMore}
            onClick={async () => {
              setIsLoadingMore(true);
              await load(page.pagination.next_cursor ?? undefined);
              setIsLoadingMore(false);
            }}
          >
            Load more
          </Button>
        </div>
      ) : null}
    </div>
  );
}
