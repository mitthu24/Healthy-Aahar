'use client';

import type { CartDto } from '@healthy-aahar/sdk';
import { Button, EmptyState, ErrorState, Skeleton } from '@healthy-aahar/ui';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { apiClient } from '@/lib/api-client';
import { setCartItemCount } from '@/lib/cart-store';
import { getSessionToken } from '@/lib/session-store';

function CartSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-20 w-full" />
      ))}
    </div>
  );
}

export default function CartPage() {
  const router = useRouter();
  const [cart, setCart] = useState<CartDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const result = await apiClient.getCart();
      setCart(result);
      setCartItemCount(result.item_count);
    } catch {
      setError('Could not load your cart.');
    }
  }

  useEffect(() => {
    if (!getSessionToken()) {
      router.replace(`/login?next=${encodeURIComponent('/cart')}`);
      return;
    }
    void load();
  }, []);

  async function updateQuantity(itemId: string, quantity: number) {
    setBusyItemId(itemId);
    try {
      const result = quantity <= 0 ? await apiClient.removeCartItem(itemId) : await apiClient.updateCartItem(itemId, { quantity });
      setCart(result);
      setCartItemCount(result.item_count);
    } finally {
      setBusyItemId(null);
    }
  }

  if (error) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!cart) return <main className="mx-auto max-w-2xl px-4 py-6"><CartSkeleton /></main>;

  if (cart.items.length === 0) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-6">
        <EmptyState
          title="Your cart is empty"
          description="Browse the catalogue and add something wholesome."
          action={
            <Link href="/products">
              <Button>Start shopping</Button>
            </Link>
          }
        />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-6 pb-32">
      <h1 className="font-display text-heading-lg text-sand-900">Your cart</h1>

      <ul className="mt-5 space-y-3">
        {cart.items.map((item) => {
          const issue = cart.issues.find((i) => i.item_id === item.id);
          return (
            <li key={item.id} className="border-sand-200 flex gap-3 rounded-lg border p-3">
              <div className="bg-sand-100 relative h-16 w-16 shrink-0 overflow-hidden rounded-md">
                {item.image_url ? (
                  <Image src={item.image_url} alt={item.product_name} fill sizes="64px" className="object-cover" />
                ) : null}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-body-sm text-sand-900 font-medium">{item.product_name}</p>
                <p className="text-caption text-sand-600">{item.variant_name}</p>
                {issue ? <p className="text-caption text-danger-600 mt-1">{issue.message}</p> : null}
                <div className="mt-2 flex items-center justify-between">
                  <div className="border-sand-200 flex items-center rounded-md border">
                    <button
                      type="button"
                      aria-label={`Decrease quantity of ${item.product_name}`}
                      disabled={busyItemId === item.id}
                      onClick={() => void updateQuantity(item.id, item.quantity - 1)}
                      className="h-9 w-9"
                    >
                      −
                    </button>
                    <span className="tabular w-7 text-center text-body-sm">{item.quantity}</span>
                    <button
                      type="button"
                      aria-label={`Increase quantity of ${item.product_name}`}
                      disabled={busyItemId === item.id}
                      onClick={() => void updateQuantity(item.id, item.quantity + 1)}
                      className="h-9 w-9"
                    >
                      +
                    </button>
                  </div>
                  <span className="text-body-sm tabular font-semibold">{item.line_total.display}</span>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="bg-sand-0 border-sand-200 fixed inset-x-0 bottom-[calc(56px+env(safe-area-inset-bottom))] z-10 border-t px-4 py-3 md:bottom-0">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-4">
          <div>
            <p className="text-caption text-sand-600">Subtotal</p>
            <p className="text-heading-sm tabular text-sand-900">{cart.subtotal.display}</p>
          </div>
          <Link href="/checkout">
            <Button size="lg" disabled={cart.issues.length > 0}>
              Proceed to checkout
            </Button>
          </Link>
        </div>
        {cart.issues.length > 0 ? (
          <p className="text-caption text-danger-600 mx-auto mt-2 max-w-2xl">
            Resolve the issues above before checking out.
          </p>
        ) : null}
      </div>
    </main>
  );
}
