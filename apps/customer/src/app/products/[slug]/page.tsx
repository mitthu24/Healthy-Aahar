'use client';

import { ApiError, type ProductDetailDto, type ProductVariantDto } from '@healthy-aahar/sdk';
import { Button, ErrorState, Skeleton } from '@healthy-aahar/ui';
import Image from 'next/image';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { apiClient } from '@/lib/api-client';
import { setCartItemCount } from '@/lib/cart-store';
import { getSessionToken } from '@/lib/session-store';

function DetailSkeleton() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <Skeleton className="aspect-square w-full rounded-lg" />
      <Skeleton className="mt-4 h-7 w-2/3" />
      <Skeleton className="mt-2 h-5 w-1/3" />
      <Skeleton className="mt-6 h-11 w-full rounded-md" />
    </main>
  );
}

export default function ProductDetailPage() {
  const params = useParams<{ slug: string }>();
  const router = useRouter();
  const [product, setProduct] = useState<ProductDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [isAdding, setIsAdding] = useState(false);
  const [addedMessage, setAddedMessage] = useState<string | null>(null);

  useEffect(() => {
    setProduct(null);
    setError(null);
    apiClient
      .getProduct(params.slug)
      .then((p) => {
        setProduct(p);
        setSelectedVariantId(p.default_variant_id);
      })
      .catch((err) => {
        setError(err instanceof ApiError && err.code === 'PRODUCT_NOT_FOUND' ? 'Product not found.' : 'Could not load this product.');
      });
  }, [params.slug]);

  const selectedVariant: ProductVariantDto | undefined = useMemo(
    () => product?.variants.find((v) => v.id === selectedVariantId),
    [product, selectedVariantId],
  );

  if (error) return <ErrorState message={error} />;
  if (!product) return <DetailSkeleton />;

  const outOfStock = selectedVariant ? selectedVariant.availability !== 'AVAILABLE' : true;
  const maxQuantity = selectedVariant?.max_order_quantity ?? 99;

  async function addToCart() {
    if (!getSessionToken()) {
      router.push(`/login?next=${encodeURIComponent(`/products/${params.slug}`)}`);
      return;
    }
    if (!selectedVariant) return;

    setIsAdding(true);
    setAddedMessage(null);
    try {
      const cart = await apiClient.addCartItem({ variant_id: selectedVariant.id, quantity });
      setCartItemCount(cart.item_count);
      setAddedMessage('Added to cart.');
    } catch {
      setAddedMessage('Could not add this item. Please try again.');
    } finally {
      setIsAdding(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-6 pb-28">
      <div className="bg-sand-100 relative aspect-square w-full overflow-hidden rounded-lg">
        {product.images[0] ? (
          <Image
            src={product.images[0].url}
            alt={product.images[0].alt_text ?? product.name}
            fill
            sizes="(max-width: 640px) 100vw, 640px"
            className="object-cover"
            priority
          />
        ) : (
          <div className="text-sand-400 flex h-full items-center justify-center">No image</div>
        )}
      </div>

      <h1 className="font-display text-heading-lg text-sand-900 mt-5">{product.name}</h1>
      {product.short_description ? <p className="text-body-sm text-sand-600 mt-1">{product.short_description}</p> : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {product.variants.map((variant) => (
          <button
            key={variant.id}
            type="button"
            onClick={() => {
              setSelectedVariantId(variant.id);
              setQuantity(1);
            }}
            className={`text-body-sm min-h-11 rounded-md border px-3 ${
              variant.id === selectedVariantId
                ? 'border-green-600 bg-green-50 text-green-700'
                : 'border-sand-200 text-sand-700'
            }`}
          >
            {variant.name}
          </button>
        ))}
      </div>

      {selectedVariant ? (
        <div className="mt-4 flex items-center gap-3">
          <span className="text-heading-md tabular text-sand-900">{selectedVariant.price.display}</span>
          {selectedVariant.mrp && selectedVariant.mrp.amount_paise > selectedVariant.price.amount_paise ? (
            <span className="text-body-sm tabular text-sand-400 line-through">{selectedVariant.mrp.display}</span>
          ) : null}
          {outOfStock ? <span className="text-body-sm text-danger-600 font-medium">Out of stock</span> : null}
        </div>
      ) : null}

      {product.description ? (
        <p className="text-body-md text-sand-700 mt-5 whitespace-pre-line">{product.description}</p>
      ) : null}

      {product.allergens.length > 0 ? (
        <p className="text-caption text-sand-600 mt-4">Allergens: {product.allergens.join(', ')}</p>
      ) : null}

      {/* Sticky add-to-cart bar (mobile-first) */}
      <div className="bg-sand-0 border-sand-200 fixed inset-x-0 bottom-[calc(56px+env(safe-area-inset-bottom))] z-10 border-t px-4 py-3 md:bottom-0">
        <div className="mx-auto flex max-w-2xl items-center gap-3">
          <div className="border-sand-200 flex items-center rounded-md border">
            <button
              type="button"
              aria-label="Decrease quantity"
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              className="h-11 w-11 text-lg"
            >
              −
            </button>
            <span className="tabular w-8 text-center">{quantity}</span>
            <button
              type="button"
              aria-label="Increase quantity"
              onClick={() => setQuantity((q) => Math.min(maxQuantity, q + 1))}
              className="h-11 w-11 text-lg"
            >
              +
            </button>
          </div>
          <Button className="flex-1" size="lg" onClick={addToCart} isLoading={isAdding} disabled={outOfStock}>
            {outOfStock ? 'Out of stock' : 'Add to cart'}
          </Button>
        </div>
        {addedMessage ? <p className="text-body-sm text-sand-700 mx-auto mt-2 max-w-2xl" role="status">{addedMessage}</p> : null}
      </div>
    </main>
  );
}
