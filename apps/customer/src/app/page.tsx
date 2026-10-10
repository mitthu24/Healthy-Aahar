'use client';

import type { CategoryDto, ProductSummaryDto } from '@healthy-aahar/sdk';
import { Skeleton } from '@healthy-aahar/ui';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { apiClient } from '@/lib/api-client';
import { ProductCard } from '@/components/product-card';
import { ProductGrid } from '@/components/product-grid';

function CategoryRail() {
  const [categories, setCategories] = useState<CategoryDto[] | null>(null);

  useEffect(() => {
    void apiClient
      .listCategories()
      .then((res) => setCategories(res.data))
      .catch(() => setCategories([]));
  }, []);

  if (categories === null) {
    return (
      <div className="flex gap-3 overflow-x-auto px-4 pb-1">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-20 shrink-0 rounded-lg" />
        ))}
      </div>
    );
  }

  if (categories.length === 0) return null;

  return (
    <div className="flex gap-3 overflow-x-auto px-4 pb-1">
      {categories.map((category) => (
        <Link
          key={category.id}
          href={`/categories/${category.slug}`}
          className="flex w-20 shrink-0 flex-col items-center gap-1.5 text-center"
        >
          <span className="bg-green-50 text-green-600 flex h-16 w-16 items-center justify-center rounded-lg text-xl font-semibold">
            {category.name.charAt(0)}
          </span>
          <span className="text-caption text-sand-700 line-clamp-2 leading-tight">{category.name}</span>
        </Link>
      ))}
    </div>
  );
}

function FeaturedRail({ onLoaded }: { onLoaded: (products: ProductSummaryDto[]) => void }) {
  useEffect(() => {
    void apiClient
      .listProducts({ limit: 20 })
      .then((res) => onLoaded(res.data))
      .catch(() => onLoaded([]));
  }, []);
  return null;
}

export default function HomePage() {
  const [featured, setFeatured] = useState<ProductSummaryDto[] | null>(null);
  const bestsellers = featured?.filter((p) => p.is_bestseller) ?? [];

  return (
    <main className="mx-auto max-w-2xl pb-8">
      <FeaturedRail onLoaded={setFeatured} />

      {/* Hero */}
      <section className="from-green-600 to-green-700 mx-4 mt-4 rounded-xl bg-gradient-to-br px-5 py-7 text-sand-0">
        <p className="text-caption font-semibold uppercase tracking-wide text-green-100">Healthy Aahar</p>
        <h1 className="font-display text-heading-lg mt-2">Real food, delivered for your slot.</h1>
        <p className="text-body-sm mt-2 max-w-xs text-green-50">
          Wholesome meals and pantry staples, cooked and packed fresh for the delivery window you choose.
        </p>
      </section>

      {/* Categories */}
      <section className="mt-6">
        <h2 className="text-heading-sm text-sand-900 px-4">Shop by category</h2>
        <div className="mt-3">
          <CategoryRail />
        </div>
      </section>

      {/* Bestsellers — only shown when real data supports it */}
      {bestsellers.length > 0 ? (
        <section className="mt-8 px-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-heading-sm text-sand-900">Bestsellers</h2>
            <Link href="/products" className="text-body-sm text-green-600 font-medium hover:underline">
              See all
            </Link>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {bestsellers.slice(0, 6).map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        </section>
      ) : null}

      {/* Full catalogue */}
      <section className="mt-8 px-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-heading-sm text-sand-900">Explore our range</h2>
          <Link href="/products" className="text-body-sm text-green-600 font-medium hover:underline">
            See all
          </Link>
        </div>
        <div className="mt-3">
          <ProductGrid
            emptyTitle="Nothing here yet"
            emptyDescription="The catalogue is being stocked — check back shortly."
          />
        </div>
      </section>
    </main>
  );
}
