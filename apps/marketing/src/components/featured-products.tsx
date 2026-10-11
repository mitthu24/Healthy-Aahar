import type { ProductSummaryDto } from '@healthy-aahar/sdk';

import { env } from '@/lib/env';
import { apiClient } from '@/lib/api-client';

import { Container } from './container';
import { ProductCard } from './product-card';
import { SectionHeading } from './section-heading';

async function getFeaturedProducts(): Promise<ProductSummaryDto[]> {
  try {
    const page = await apiClient.listProducts({ limit: 8 });
    return page.data;
  } catch {
    // The marketing site must never 500 for a backend hiccup (BR-MK6) — an
    // empty rail degrades to the "nothing published yet" state below.
    return [];
  }
}

export async function FeaturedProducts() {
  const products = await getFeaturedProducts();

  return (
    <section className="py-16 sm:py-20">
      <Container>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <SectionHeading eyebrow="Today's menu" title="Fresh picks, ready to order" />
          <a
            href={`${env.NEXT_PUBLIC_APP_URL}/products?ref=marketing`}
            className="text-body-sm font-semibold text-green-700 hover:underline"
          >
            Shop all products &rarr;
          </a>
        </div>

        {products.length === 0 ? (
          <div className="border-sand-200 bg-sand-50 mt-10 rounded-xl border border-dashed p-10 text-center">
            <p className="text-heading-sm text-sand-800">The menu is being prepared</p>
            <p className="text-body-sm text-sand-600 mx-auto mt-2 max-w-sm">
              We&rsquo;re setting up today&rsquo;s catalogue. Check back shortly, or explore the
              shop for the latest availability.
            </p>
          </div>
        ) : (
          <div className="mt-10 grid grid-cols-2 gap-4 sm:gap-5 lg:grid-cols-4">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        )}
      </Container>
    </section>
  );
}
