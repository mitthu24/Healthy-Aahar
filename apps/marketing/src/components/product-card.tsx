import type { ProductSummaryDto } from '@healthy-aahar/sdk';
import Image from 'next/image';

import { env } from '@/lib/env';

/**
 * Read-only — the marketing site never adds to a cart (BR-MK5). The CTA
 * deep-links straight to the matching product in the customer app
 * (docs/16 §6), carrying only a `ref`, never PII or a cart/session token.
 */
export function ProductCard({ product }: { product: ProductSummaryDto }) {
  const outOfStock = product.availability !== 'AVAILABLE';
  const href = `${env.NEXT_PUBLIC_APP_URL}/products/${product.slug}?ref=marketing`;

  return (
    <a
      href={href}
      className="bg-sand-0 border-sand-200 group flex flex-col overflow-hidden rounded-xl border transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600"
    >
      <div className="bg-sand-100 relative aspect-square w-full overflow-hidden">
        {product.image_url ? (
          <Image
            src={product.image_url}
            alt={product.name}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 280px"
            className="object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="text-sand-400 text-caption flex h-full items-center justify-center">
            No image yet
          </div>
        )}
        {product.is_bestseller ? (
          <span className="bg-citrus-500 text-caption text-sand-0 absolute left-2 top-2 rounded-full px-2.5 py-1 font-semibold">
            Bestseller
          </span>
        ) : product.is_new ? (
          <span className="text-caption text-sand-0 absolute left-2 top-2 rounded-full bg-green-700 px-2.5 py-1 font-semibold">
            New
          </span>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-1 p-4">
        <p className="text-caption text-sand-400">{product.category.name}</p>
        <h3 className="text-body-md text-sand-900 line-clamp-2 font-semibold">{product.name}</h3>
        {product.short_description ? (
          <p className="text-body-sm text-sand-600 line-clamp-1">{product.short_description}</p>
        ) : null}

        <div className="mt-auto flex items-center justify-between pt-3">
          <span className="text-body-md text-sand-900 font-semibold">
            {product.from_price.display}
          </span>
          {outOfStock ? (
            <span className="text-caption text-danger-600 font-medium">Out of stock</span>
          ) : (
            <span className="text-caption font-semibold text-green-700 group-hover:underline">
              Shop now
            </span>
          )}
        </div>
      </div>
    </a>
  );
}
