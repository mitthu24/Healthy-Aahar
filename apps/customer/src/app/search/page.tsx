'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { ProductGrid } from '@/components/product-grid';
import { useDebouncedValue } from '@/lib/use-debounced-value';

function SearchResults() {
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(searchParams.get('q') ?? '');
  const debouncedQuery = useDebouncedValue(query, 300);

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="font-display text-heading-lg text-sand-900">Search</h1>

      <label htmlFor="search-page-input" className="sr-only">
        Search products
      </label>
      <input
        id="search-page-input"
        type="search"
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search for dal, millets, khichdi..."
        className="border-sand-200 bg-sand-0 text-body-md mt-4 h-12 w-full rounded-full border px-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600"
      />

      <div className="mt-6">
        {debouncedQuery.trim().length > 0 ? (
          <ProductGrid
            q={debouncedQuery.trim()}
            emptyTitle={`No results for "${debouncedQuery.trim()}"`}
            emptyDescription="Try a different word, or browse by category instead."
          />
        ) : (
          <p className="text-body-sm text-sand-600">Start typing to search the catalogue.</p>
        )}
      </div>
    </main>
  );
}

export default function SearchPage() {
  return (
    <Suspense>
      <SearchResults />
    </Suspense>
  );
}
