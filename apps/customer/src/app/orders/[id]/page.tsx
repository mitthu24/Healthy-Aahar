'use client';

import { ApiError, type OrderDto } from '@healthy-aahar/sdk';
import { Badge, Button, Card, ErrorState, Skeleton, orderStatusTone } from '@healthy-aahar/ui';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

import { apiClient } from '@/lib/api-client';
import { canCancelDisplayStatus } from '@/lib/order-status-helpers';

function OrderDetail() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const [order, setOrder] = useState<OrderDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);

  async function load() {
    setError(null);
    try {
      setOrder(await apiClient.getMyOrder(params.id));
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'NOT_FOUND'
          ? 'Order not found.'
          : 'Could not load this order.',
      );
    }
  }

  useEffect(() => {
    void load();
  }, [params.id]);

  async function cancel() {
    setIsCancelling(true);
    try {
      setOrder(await apiClient.cancelMyOrder(params.id));
    } catch {
      setError('This order can no longer be cancelled.');
    } finally {
      setIsCancelling(false);
    }
  }

  if (error) return <ErrorState message={error} />;
  if (!order) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-6">
        <Skeleton className="h-40 w-full" />
      </main>
    );
  }

  const justConfirmed = searchParams.get('confirmed') === '1' && order.status === 'CONFIRMED';

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      {justConfirmed ? (
        <Card className="bg-success-50 mb-5 border-none p-4">
          <p className="text-body-md text-success-600 font-semibold">Order confirmed!</p>
          <p className="text-body-sm text-sand-700 mt-1">
            We've received your order and it's been confirmed. You'll see fulfilment updates here.
          </p>
        </Card>
      ) : null}

      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-heading-lg text-sand-900">{order.order_number}</h1>
          <p className="text-body-sm text-sand-600 mt-1">
            Placed{' '}
            {new Date(order.placed_at).toLocaleString('en-IN', {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}
          </p>
        </div>
        <Badge tone={orderStatusTone(order.display_status)}>{order.display_status}</Badge>
      </div>

      {order.cancellation_reason ? (
        <p className="text-body-sm text-sand-600 mt-3">Reason: {order.cancellation_reason}</p>
      ) : null}

      <section className="mt-6">
        <h2 className="text-heading-sm text-sand-900">Items</h2>
        <Card className="mt-3 p-4">
          <ul className="divide-sand-100 divide-y">
            {order.items.map((item) => (
              <li key={item.id} className="text-body-sm flex justify-between py-2">
                <span className="text-sand-700">
                  {item.product_name}
                  {item.variant_name ? ` (${item.variant_name})` : ''} × {item.quantity}
                </span>
                <span className="tabular text-sand-900">{item.line_total.display}</span>
              </li>
            ))}
          </ul>
          <div className="border-sand-100 mt-2 space-y-1 border-t pt-3">
            <div className="text-body-sm text-sand-700 flex justify-between">
              <span>Subtotal</span>
              <span className="tabular">{order.subtotal.display}</span>
            </div>
            <div className="text-body-sm text-sand-700 flex justify-between">
              <span>Delivery fee</span>
              <span className="tabular">{order.delivery_fee.display}</span>
            </div>
            <div className="text-body-sm text-sand-700 flex justify-between">
              <span>Tax</span>
              <span className="tabular">{order.tax.display}</span>
            </div>
            <div className="text-body-md tabular flex justify-between font-semibold">
              <span>Total</span>
              <span>{order.total.display}</span>
            </div>
          </div>
        </Card>
      </section>

      <section className="mt-6">
        <h2 className="text-heading-sm text-sand-900">Delivery</h2>
        <Card className="mt-3 p-4">
          <p className="text-body-sm text-sand-900 font-medium">
            {order.delivery_address.recipient_name}
          </p>
          <p className="text-body-sm text-sand-700">
            {order.delivery_address.line1}
            {order.delivery_address.line2 ? `, ${order.delivery_address.line2}` : ''},{' '}
            {order.delivery_address.city}, {order.delivery_address.state}{' '}
            {order.delivery_address.pincode}
          </p>
          <p className="text-caption text-sand-600 mt-2">
            {order.service_date} · {order.slot_name}
          </p>
        </Card>
      </section>

      <section className="mt-6">
        <h2 className="text-heading-sm text-sand-900">Payment</h2>
        <Card className="mt-3 flex items-center justify-between p-4">
          <span className="text-body-sm text-sand-800">Cash / UPI on Delivery</span>
          <Badge tone={order.payment_status === 'PAID' ? 'success' : 'neutral'}>
            {order.payment_status === 'PAID' ? 'Paid on delivery' : 'Payment due on delivery'}
          </Badge>
        </Card>
      </section>

      {canCancelDisplayStatus(order.display_status) ? (
        <div className="mt-6">
          <Button variant="danger" isLoading={isCancelling} onClick={cancel}>
            Cancel order
          </Button>
        </div>
      ) : null}
    </main>
  );
}

export default function OrderDetailPage() {
  return (
    <Suspense>
      <OrderDetail />
    </Suspense>
  );
}
