'use client';

import type { CategoryDto } from '@healthy-aahar/sdk';
import { ErrorState, Skeleton } from '@healthy-aahar/ui';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { apiClient } from '@/lib/api-client';
import { ProductGrid } from '@/components/product-grid';

export default function CategoryPage() {
  const params = useParams<{ slug: string }>();
  const [category, setCategory] = useState<CategoryDto | null | undefined>(undefined);

  useEffect(() => {
    setCategory(undefined);
    void apiClient
      .listCategories()
      .then((res) => setCategory(res.data.find((c) => c.slug === params.slug) ?? null))
      .catch(() => setCategory(null));
  }, [params.slug]);

  if (category === undefined) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-6">
        <Skeleton className="h-8 w-48" />
      </main>
    );
  }

  if (category === null) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-6">
        <ErrorState message="This category could not be found." />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="font-display text-heading-lg text-sand-900">{category.name}</h1>
      {category.description ? (
        <p className="text-body-sm text-sand-600 mt-2">{category.description}</p>
      ) : null}
      <div className="mt-5">
        <ProductGrid categoryId={category.id} emptyTitle="No products in this category yet" />
      </div>
    </main>
  );
}
