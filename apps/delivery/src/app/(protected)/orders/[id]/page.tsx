'use client';

import { ApiError, type DeliveryOrderDto } from '@healthy-aahar/sdk';
import { Badge, Button, Card, ErrorState, orderStatusTone, Skeleton } from '@healthy-aahar/ui';
import { useParams } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';

import { apiClient } from '@/lib/api-client';

function displayLabel(status: string): string {
  switch (status) {
    case 'READY_FOR_DISPATCH':
      return 'Awaiting pickup';
    case 'OUT_FOR_DELIVERY':
      return 'Out for delivery';
    case 'DELIVERED':
      return 'Delivered';
    case 'FAILED':
      return 'Delivery failed';
    default:
      return status;
  }
}

/** Google Maps search link — no API key, works with just an address string. */
function mapsUrl(order: DeliveryOrderDto): string {
  const a = order.delivery_address;
  const query = [a.line1, a.line2, a.landmark, a.city, a.state, a.pincode]
    .filter(Boolean)
    .join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

type Dialog = 'fail' | 'collect' | null;

export default function MyDeliveryDetailPage() {
  const params = useParams<{ id: string }>();
  const [order, setOrder] = useState<DeliveryOrderDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [reasonText, setReasonText] = useState('');
  const [isBusy, setIsBusy] = useState(false);

  async function load() {
    setError(null);
    try {
      setOrder(await apiClient.getMyDelivery(params.id));
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'NOT_FOUND'
          ? 'This delivery was not found, or is no longer assigned to you.'
          : 'Could not load this delivery.',
      );
    }
  }

  useEffect(() => {
    void load();
  }, [params.id]);

  async function runAction(action: () => Promise<DeliveryOrderDto>) {
    setIsBusy(true);
    setActionError(null);
    try {
      setOrder(await action());
      setDialog(null);
      setReasonText('');
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'That action could not be completed.');
    } finally {
      setIsBusy(false);
    }
  }

  if (error) return <ErrorState message={error} />;
  if (!order) {
    return (
      <main className="mx-auto max-w-md px-5 py-8">
        <Skeleton className="h-64 w-full" />
      </main>
    );
  }

  async function onDialogSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (dialog === 'fail') {
      await runAction(() => apiClient.markDeliveryFailed(order!.id, reasonText));
    } else if (dialog === 'collect') {
      await runAction(() =>
        apiClient.recordDeliveryCodCollection(order!.id, order!.cod_amount_due!.amount_paise),
      );
    }
  }

  return (
    <main className="mx-auto max-w-md px-5 py-6">
      <div className="flex items-start justify-between gap-3">
        <h1 className="font-display text-heading-md text-sand-900">{order.order_number}</h1>
        <Badge tone={orderStatusTone(displayLabel(order.status))}>
          {displayLabel(order.status)}
        </Badge>
      </div>

      <Card className="mt-4 p-4">
        <h2 className="text-caption text-sand-500 font-semibold uppercase">Recipient</h2>
        <p className="text-body-md text-sand-900 mt-1 font-medium">{order.recipient_name}</p>
        <a
          href={`tel:${order.recipient_phone}`}
          className="text-body-sm mt-0.5 block text-green-700"
        >
          {order.recipient_phone}
        </a>
      </Card>

      <Card className="mt-3 p-4">
        <h2 className="text-caption text-sand-500 font-semibold uppercase">Delivery address</h2>
        <p className="text-body-sm text-sand-800 mt-1">
          {order.delivery_address.line1}
          {order.delivery_address.line2 ? `, ${order.delivery_address.line2}` : ''}
          {order.delivery_address.landmark ? ` (near ${order.delivery_address.landmark})` : ''},{' '}
          {order.delivery_address.city}, {order.delivery_address.state}{' '}
          {order.delivery_address.pincode}
        </p>
        <p className="text-caption text-sand-600 mt-1">
          {order.service_date} · {order.slot_name}
        </p>
        <a
          href={mapsUrl(order)}
          target="_blank"
          rel="noreferrer"
          className="text-body-sm mt-2 inline-block font-medium text-green-700"
        >
          Open in Maps →
        </a>
      </Card>

      <Card className="mt-3 p-4">
        <h2 className="text-caption text-sand-500 font-semibold uppercase">Items</h2>
        <ul className="divide-sand-100 mt-1 divide-y">
          {order.items.map((item) => (
            <li key={item.id} className="text-body-sm flex justify-between py-2">
              <span className="text-sand-700">
                {item.product_name}
                {item.variant_name ? ` (${item.variant_name})` : ''} × {item.quantity}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="mt-3 flex items-center justify-between p-4">
        <div>
          <p className="text-body-sm text-sand-800 font-semibold">{order.payment_method}</p>
          {order.cod_amount_due ? (
            <p className="text-body-sm text-sand-700">Collect {order.cod_amount_due.display}</p>
          ) : null}
        </div>
        <Badge tone={order.cod_collected ? 'success' : 'neutral'}>
          {order.cod_collected ? 'Collected' : order.payment_method === 'COD' ? 'Due' : 'Prepaid'}
        </Badge>
      </Card>

      {order.customer_note ? (
        <Card className="bg-warning-50 mt-3 border-none p-4">
          <p className="text-caption text-warning-600 font-semibold uppercase">Customer note</p>
          <p className="text-body-sm text-sand-800 mt-1">{order.customer_note}</p>
        </Card>
      ) : null}

      {order.failure_reason ? (
        <p className="text-body-sm text-danger-600 mt-3">Failure reason: {order.failure_reason}</p>
      ) : null}

      {actionError ? (
        <p role="alert" className="text-body-sm text-danger-600 mt-3">
          {actionError}
        </p>
      ) : null}

      <div className="mt-5 flex flex-col gap-3">
        {order.status === 'READY_FOR_DISPATCH' ? (
          <Button
            size="lg"
            isLoading={isBusy}
            onClick={() => void runAction(() => apiClient.acceptDelivery(order.id))}
          >
            Accept &amp; start delivery
          </Button>
        ) : null}
        {order.status === 'OUT_FOR_DELIVERY' ? (
          <>
            <Button
              size="lg"
              isLoading={isBusy}
              onClick={() => void runAction(() => apiClient.markDeliveryDelivered(order.id))}
            >
              Mark delivered
            </Button>
            {order.payment_method === 'COD' && !order.cod_collected ? (
              <Button size="lg" variant="secondary" onClick={() => setDialog('collect')}>
                Record COD collection
              </Button>
            ) : null}
            <Button size="lg" variant="danger" onClick={() => setDialog('fail')}>
              Delivery failed
            </Button>
          </>
        ) : null}
        {order.status === 'DELIVERED' && order.payment_method === 'COD' && !order.cod_collected ? (
          <Button size="lg" variant="secondary" onClick={() => setDialog('collect')}>
            Record COD collection
          </Button>
        ) : null}
      </div>

      {dialog ? (
        <Card className="mt-5 p-4">
          <form onSubmit={onDialogSubmit} className="space-y-3">
            {dialog === 'collect' ? (
              <p className="text-body-sm text-sand-700">
                Confirm you collected <strong>{order.cod_amount_due?.display}</strong> from the
                customer.
              </p>
            ) : (
              <>
                <label htmlFor="fail-reason" className="text-body-sm text-sand-700 font-medium">
                  Reason the delivery failed
                </label>
                <textarea
                  id="fail-reason"
                  required
                  value={reasonText}
                  onChange={(e) => setReasonText(e.target.value)}
                  maxLength={500}
                  className="border-sand-200 bg-sand-0 text-body-sm h-20 w-full rounded-md border px-3 py-2"
                />
              </>
            )}
            <div className="flex gap-3">
              <Button
                type="submit"
                variant={dialog === 'fail' ? 'danger' : 'primary'}
                isLoading={isBusy}
              >
                Confirm
              </Button>
              <Button type="button" variant="secondary" onClick={() => setDialog(null)}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      ) : null}
    </main>
  );
}
