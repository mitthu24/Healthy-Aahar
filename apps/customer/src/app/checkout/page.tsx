'use client';

import type { AddressDto, CartDto, DeliverySlotDto } from '@healthy-aahar/sdk';
import { ApiError } from '@healthy-aahar/sdk';
import { Button, Card, EmptyState, ErrorState, FieldError, Skeleton } from '@healthy-aahar/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { apiClient } from '@/lib/api-client';
import { setCartItemCount } from '@/lib/cart-store';
import { getSessionToken } from '@/lib/session-store';

function todayPlusDays(days: number): string {
  const date = new Date(Date.now());
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

export default function CheckoutPage() {
  const router = useRouter();
  const [cart, setCart] = useState<CartDto | null>(null);
  const [addresses, setAddresses] = useState<AddressDto[] | null>(null);
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);
  const [slots, setSlots] = useState<DeliverySlotDto[] | null>(null);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [serviceDate, setServiceDate] = useState(todayPlusDays(1));
  const [customerNote, setCustomerNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPlacing, setIsPlacing] = useState(false);

  useEffect(() => {
    if (!getSessionToken()) {
      router.replace(`/login?next=${encodeURIComponent('/checkout')}`);
      return;
    }
    void (async () => {
      try {
        const [cartResult, addressResult] = await Promise.all([apiClient.getCart(), apiClient.listAddresses()]);
        setCart(cartResult);
        setAddresses(addressResult.data);
        const preferred = addressResult.data.find((a) => a.is_default) ?? addressResult.data[0];
        if (preferred) setSelectedAddressId(preferred.id);
      } catch {
        setError('Could not load checkout details.');
      }
    })();
  }, []);

  useEffect(() => {
    if (!selectedAddressId) return;
    setSlots(null);
    setSelectedSlotId(null);
    void apiClient
      .listDeliverySlots(selectedAddressId)
      .then((res) => {
        setSlots(res.data);
        if (res.data[0]) setSelectedSlotId(res.data[0].id);
      })
      .catch(() => setSlots([]));
  }, [selectedAddressId]);

  async function placeOrder() {
    if (!selectedAddressId || !selectedSlotId) return;

    setError(null);
    setIsPlacing(true);
    // A fresh key per attempt; the SAME key is reused by the SDK/browser
    // only if this exact request is retried (e.g. a network failure before
    // a response arrives) — never across unrelated clicks.
    const idempotencyKey =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;

    try {
      const order = await apiClient.checkout(
        {
          address_id: selectedAddressId,
          delivery_slot_id: selectedSlotId,
          service_date: serviceDate,
          customer_note: customerNote || undefined,
        },
        idempotencyKey,
      );
      setCartItemCount(0);
      router.push(`/orders/${order.id}?confirmed=1`);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'CART_EMPTY') setError('Your cart is empty.');
        else if (err.code === 'INSUFFICIENT_STOCK' || err.code === 'ITEM_NOT_AVAILABLE') {
          setError(`${err.message} Please review your cart.`);
        } else if (err.code === 'ADDRESS_NOT_SERVICEABLE') {
          setError('This address is not yet deliverable. Please choose a different address.');
        } else if (err.code === 'MIN_ORDER_NOT_MET' || err.code === 'SLOT_NOT_AVAILABLE_ON_DAY') {
          setError(err.message);
        } else {
          setError('We could not place your order. Please try again.');
        }
      } else {
        setError('We could not place your order. Please try again.');
      }
    } finally {
      setIsPlacing(false);
    }
  }

  if (error && !cart) return <ErrorState message={error} />;
  if (!cart || addresses === null) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-6">
        <Skeleton className="h-40 w-full" />
      </main>
    );
  }

  if (cart.items.length === 0) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-6">
        <EmptyState title="Your cart is empty" />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-6 pb-32">
      <h1 className="font-display text-heading-lg text-sand-900">Checkout</h1>

      <section className="mt-5">
        <div className="flex items-baseline justify-between">
          <h2 className="text-heading-sm text-sand-900">Delivery address</h2>
          <Link href="/addresses" className="text-body-sm text-green-600 font-medium hover:underline">
            Manage
          </Link>
        </div>

        {addresses.length === 0 ? (
          <Card className="mt-3 p-4">
            <p className="text-body-sm text-sand-700">You have no saved addresses yet.</p>
            <Link href={`/addresses?next=${encodeURIComponent('/checkout')}`}>
              <Button className="mt-3" size="sm">
                Add an address
              </Button>
            </Link>
          </Card>
        ) : (
          <div className="mt-3 space-y-2">
            {addresses.map((address) => (
              <label
                key={address.id}
                className={`block cursor-pointer rounded-lg border p-3 ${
                  selectedAddressId === address.id ? 'border-green-600 bg-green-50' : 'border-sand-200'
                }`}
              >
                <input
                  type="radio"
                  name="address"
                  className="sr-only"
                  checked={selectedAddressId === address.id}
                  onChange={() => setSelectedAddressId(address.id)}
                />
                <p className="text-body-sm text-sand-900 font-medium">{address.recipient_name}</p>
                <p className="text-body-sm text-sand-700">
                  {address.line1}, {address.city}, {address.state} {address.pincode}
                </p>
                {!address.is_serviceable ? (
                  <p className="text-caption text-danger-600 mt-1">Not yet deliverable to this address.</p>
                ) : null}
              </label>
            ))}
          </div>
        )}
      </section>

      {selectedAddressId ? (
        <section className="mt-6">
          <h2 className="text-heading-sm text-sand-900">Delivery slot</h2>
          {slots === null ? (
            <Skeleton className="mt-3 h-11 w-full" />
          ) : slots.length === 0 ? (
            <p className="text-body-sm text-danger-600 mt-2">No delivery slots are available for this address yet.</p>
          ) : (
            <div className="mt-3 space-y-3">
              <input
                type="date"
                value={serviceDate}
                min={todayPlusDays(1)}
                onChange={(e) => setServiceDate(e.target.value)}
                className="border-sand-200 bg-sand-0 text-body-md h-11 w-full rounded-md border px-3"
              />
              <div className="flex flex-wrap gap-2">
                {slots.map((slot) => (
                  <button
                    key={slot.id}
                    type="button"
                    onClick={() => setSelectedSlotId(slot.id)}
                    className={`text-body-sm min-h-11 rounded-md border px-3 ${
                      slot.id === selectedSlotId ? 'border-green-600 bg-green-50 text-green-700' : 'border-sand-200'
                    }`}
                  >
                    {slot.name} · {slot.start_time}–{slot.end_time}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>
      ) : null}

      <section className="mt-6">
        <h2 className="text-heading-sm text-sand-900">Order summary</h2>
        <Card className="mt-3 p-4">
          <ul className="divide-sand-100 divide-y">
            {cart.items.map((item) => (
              <li key={item.id} className="text-body-sm flex justify-between py-2">
                <span className="text-sand-700">
                  {item.product_name} × {item.quantity}
                </span>
                <span className="tabular text-sand-900">{item.line_total.display}</span>
              </li>
            ))}
          </ul>
          <div className="text-body-md tabular border-sand-100 mt-2 flex justify-between border-t pt-3 font-semibold">
            <span>Total</span>
            <span>{cart.subtotal.display}</span>
          </div>
          <p className="text-caption text-sand-600 mt-1">
            Delivery fee and tax are calculated by the server at checkout and shown on your order.
          </p>
        </Card>
      </section>

      <section className="mt-6">
        <h2 className="text-heading-sm text-sand-900">Delivery notes (optional)</h2>
        <textarea
          value={customerNote}
          onChange={(e) => setCustomerNote(e.target.value)}
          placeholder="E.g. ring the bell twice, leave at the gate"
          maxLength={500}
          className="border-sand-200 bg-sand-0 text-body-sm mt-3 h-20 w-full rounded-md border px-3 py-2"
        />
      </section>

      <section className="mt-6">
        <h2 className="text-heading-sm text-sand-900">Payment method</h2>
        <Card className="mt-3 flex items-center justify-between p-4">
          <span className="text-body-sm text-sand-800 font-medium">Cash / UPI on Delivery</span>
          <span className="text-caption text-sand-600">Pay when your order arrives</span>
        </Card>
      </section>

      <FieldError>{error}</FieldError>

      <div className="bg-sand-0 border-sand-200 fixed inset-x-0 bottom-[calc(56px+env(safe-area-inset-bottom))] z-10 border-t px-4 py-3 md:bottom-0">
        <div className="mx-auto max-w-2xl">
          <Button
            size="lg"
            className="w-full"
            isLoading={isPlacing}
            disabled={!selectedAddressId || !selectedSlotId}
            onClick={placeOrder}
          >
            Place order ({cart.subtotal.display})
          </Button>
        </div>
      </div>
    </main>
  );
}
