import type { Metadata } from 'next';
import Link from 'next/link';

import type { CategoryDto } from '@healthy-aahar/sdk';
import { EmptyState, ErrorState } from '@healthy-aahar/ui';

import { apiClient } from '@/lib/api-client';
import { env } from '@/lib/env';
import { Container } from '@/components/container';
import { ProductCard } from '@/components/product-card';
import { SearchIcon } from '@/components/icons';

export const revalidate = 300;

export const metadata: Metadata = {
  title: 'Shop fresh, healthy food',
  description:
    'Browse fresh fruit, salads, sprouts and healthy meals available for delivery in Noida today.',
};

type SearchParams = { category?: string; q?: string; cursor?: string };

async function getCategories(): Promise<CategoryDto[]> {
  try {
    return (await apiClient.listCategories()).data;
  } catch {
    return [];
  }
}

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const categories = await getCategories();

  let page: Awaited<ReturnType<typeof apiClient.listProducts>> | null = null;
  let loadError = false;
  try {
    page = await apiClient.listProducts({
      limit: 24,
      category_id: params.category,
      q: params.q,
      cursor: params.cursor,
    });
  } catch {
    loadError = true;
  }

  const activeCategory = categories.find((c) => c.id === params.category);

  return (
    <Container className="py-10 sm:py-14">
      <div className="max-w-2xl">
        <p className="text-caption font-semibold tracking-wide text-green-600 uppercase">Shop</p>
        <h1 className="font-display text-display-sm text-sand-900 mt-2">
          {activeCategory ? activeCategory.name : "Today's menu"}
        </h1>
        <p className="text-body-md text-sand-600 mt-3">
          Prepared fresh and delivered to Noida in your chosen slot. For checkout, you&rsquo;ll
          continue in the Healthy Aahar app.
        </p>
      </div>

      <form method="get" className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 sm:max-w-xs">
          <SearchIcon className="text-sand-400 pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <input
            type="search"
            name="q"
            defaultValue={params.q ?? ''}
            placeholder="Search products"
            className="border-sand-200 bg-sand-0 text-body-sm placeholder:text-sand-400 focus-visible:ring-green-600 h-11 w-full rounded-md border pl-9 pr-3 focus-visible:outline-none focus-visible:ring-2"
          />
        </div>
        {params.category ? <input type="hidden" name="category" value={params.category} /> : null}
        <button
          type="submit"
          className="text-body-sm text-green-700 hover:underline sm:hidden"
        >
          Search
        </button>
      </form>

      {categories.length > 0 ? (
        <div className="mt-5 flex flex-wrap gap-2">
          <Link
            href="/products"
            className={`text-body-sm focus-visible:ring-green-600 rounded-full border px-3.5 py-1.5 font-medium focus-visible:outline-none focus-visible:ring-2 ${
              !params.category
                ? 'border-green-700 bg-green-700 text-sand-0'
                : 'border-sand-200 text-sand-700 hover:border-green-600'
            }`}
          >
            All
          </Link>
          {categories.map((category) => (
            <Link
              key={category.id}
              href={`/products?category=${category.id}`}
              className={`text-body-sm focus-visible:ring-green-600 rounded-full border px-3.5 py-1.5 font-medium focus-visible:outline-none focus-visible:ring-2 ${
                params.category === category.id
                  ? 'border-green-700 bg-green-700 text-sand-0'
                  : 'border-sand-200 text-sand-700 hover:border-green-600'
              }`}
            >
              {category.name}
            </Link>
          ))}
        </div>
      ) : null}

      <div className="mt-10">
        {loadError ? (
          <ErrorState message="We couldn't load the menu right now. Please try again shortly." />
        ) : !page || page.data.length === 0 ? (
          <EmptyState
            title={params.q || params.category ? 'No products match that filter' : 'The menu is being prepared'}
            description={
              params.q || params.category
                ? 'Try a different search term or browse all products.'
                : "We're setting up today's catalogue. Check back shortly."
            }
            action={
              params.q || params.category ? (
                <Link href="/products" className="text-body-sm font-semibold text-green-700 hover:underline">
                  Clear filters
                </Link>
              ) : undefined
            }
          />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 sm:gap-5 lg:grid-cols-4">
              {page.data.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>

            {page.pagination.has_more && page.pagination.next_cursor ? (
              <div className="mt-10 text-center">
                <Link
                  href={`/products?${new URLSearchParams({
                    ...(params.category ? { category: params.category } : {}),
                    ...(params.q ? { q: params.q } : {}),
                    cursor: page.pagination.next_cursor,
                  }).toString()}`}
                  className="border-sand-200 text-body-sm hover:border-green-600 inline-flex h-11 items-center rounded-md border px-5 font-semibold text-green-700"
                >
                  Load more
                </Link>
              </div>
            ) : null}
          </>
        )}
      </div>

      <p className="text-caption text-sand-400 mt-10">
        Ready to order?{' '}
        <a
          href={`${env.NEXT_PUBLIC_APP_URL}/products?ref=marketing`}
          className="font-semibold text-green-700 hover:underline"
        >
          Continue in the Healthy Aahar app &rarr;
        </a>
      </p>
    </Container>
  );
}
