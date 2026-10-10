'use client';

import type { ProductSummaryDto } from '@healthy-aahar/sdk';
import { Button } from '@healthy-aahar/ui';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { apiClient } from '@/lib/api-client';
import { setCartItemCount } from '@/lib/cart-store';
import { getSessionToken } from '@/lib/session-store';

export function ProductCard({ product }: { product: ProductSummaryDto }) {
  const router = useRouter();
  const [isAdding, setIsAdding] = useState(false);
  const outOfStock = product.availability !== 'AVAILABLE';

  async function quickAdd() {
    if (!getSessionToken()) {
      router.push(`/login?next=${encodeURIComponent('/products')}`);
      return;
    }
    setIsAdding(true);
    try {
      const cart = await apiClient.addCartItem({ variant_id: product.default_variant_id, quantity: 1 });
      setCartItemCount(cart.item_count);
    } finally {
      setIsAdding(false);
    }
  }

  return (
    <div className="bg-sand-0 border-sand-200 flex flex-col overflow-hidden rounded-lg border">
      <Link href={`/products/${product.slug}`} className="block">
        <div className="bg-sand-100 relative aspect-square w-full">
          {product.image_url ? (
            <Image
              src={product.image_url}
              alt={product.name}
              fill
              sizes="(max-width: 640px) 50vw, 220px"
              className="object-cover"
            />
          ) : (
            <div className="text-sand-400 text-caption flex h-full items-center justify-center">No image</div>
          )}
        </div>
      </Link>

      <div className="flex flex-1 flex-col gap-1 p-3">
        <Link href={`/products/${product.slug}`} className="text-body-sm text-sand-900 line-clamp-2 font-medium">
          {product.name}
        </Link>
        {product.short_description ? (
          <p className="text-caption text-sand-600 line-clamp-1">{product.short_description}</p>
        ) : null}

        <div className="mt-auto flex items-center justify-between pt-2">
          <span className="text-body-md tabular text-sand-900 font-semibold">{product.from_price.display}</span>
          {outOfStock ? (
            <span className="text-caption text-danger-600 font-medium">Out of stock</span>
          ) : (
            <Button size="sm" variant="secondary" onClick={quickAdd} isLoading={isAdding}>
              Add
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
