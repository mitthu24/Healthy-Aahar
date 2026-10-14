'use client';

import { ApiError, type AdminOrderDto, type DeliveryPartnerDto } from '@healthy-aahar/sdk';
import { Badge, Button, Card, ErrorState, Skeleton } from '@healthy-aahar/ui';
import { useParams } from 'next/navigation';
import { useState, useEffect, type FormEvent } from 'react';

import { apiClient } from '@/lib/api-client';
import {
  adminStatusTone,
  canHold,
  canMarkDeliveryFailed,
  canReject,
  canRecordCodCollection,
  nextFulfilmentStatus,
} from '@/lib/order-status';

type Dialog = 'reject' | 'hold' | 'fail' | 'collect' | 'assign' | null;

const ASSIGNABLE_STATUSES = new Set(['READY_FOR_DISPATCH', 'OUT_FOR_DELIVERY']);

export default function AdminOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const [order, setOrder] = useState<AdminOrderDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [reasonText, setReasonText] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [eligiblePartners, setEligiblePartners] = useState<DeliveryPartnerDto[] | null>(null);
  const [selectedPartnerId, setSelectedPartnerId] = useState('');

  async function load() {
    setError(null);
    try {
      setOrder(await apiClient.getAdminOrder(params.id));
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

  async function runAction(action: () => Promise<AdminOrderDto>) {
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
      <main className="mx-auto max-w-3xl px-6 py-8">
        <Skeleton className="h-64 w-full" />
      </main>
    );
  }

  const next = nextFulfilmentStatus(order.status);
  const isReassignment = order.assigned_partner_id !== null;

  async function openAssignDialog() {
    setDialog('assign');
    setSelectedPartnerId('');
    try {
      const res = await apiClient.listDeliveryPartners({ duty_status: 'ON_DUTY' });
      setEligiblePartners(res.data.filter((p) => !p.deactivated));
    } catch {
      setEligiblePartners([]);
    }
  }

  async function onDialogSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (dialog === 'reject') {
      await runAction(() => apiClient.rejectAdminOrder(order!.id, reasonText));
    } else if (dialog === 'hold') {
      await runAction(() => apiClient.holdAdminOrder(order!.id, reasonText));
    } else if (dialog === 'fail') {
      await runAction(() =>
        apiClient.updateAdminOrderStatus(order!.id, { to_status: 'FAILED', reason: reasonText }),
      );
    } else if (dialog === 'collect') {
      await runAction(() => apiClient.recordCodCollection(order!.id, order!.total.amount_paise));
    } else if (dialog === 'assign') {
      await runAction(() =>
        apiClient.assignOrder(order!.id, {
          partner_admin_user_id: selectedPartnerId,
          reason: isReassignment ? reasonText : undefined,
        }),
      );
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
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
        <Badge tone={adminStatusTone(order.status)}>{order.status.replaceAll('_', ' ')}</Badge>
      </div>

      <section className="mt-6 grid gap-4 sm:grid-cols-2">
        <Card className="p-4">
          <h2 className="text-heading-sm text-sand-900">Customer</h2>
          <p className="text-body-sm text-sand-700 mt-2">{order.customer_name}</p>
          <p className="text-body-sm text-sand-700">{order.customer_phone}</p>
        </Card>
        <Card className="p-4">
          <h2 className="text-heading-sm text-sand-900">Delivery</h2>
          <p className="text-body-sm text-sand-700 mt-2">
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

      <section className="mt-4">
        <Card className="p-4">
          <h2 className="text-heading-sm text-sand-900">Items</h2>
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
          <div className="text-body-md tabular border-sand-100 mt-2 flex justify-between border-t pt-3 font-semibold">
            <span>Total</span>
            <span>{order.total.display}</span>
          </div>
        </Card>
      </section>

      <section className="mt-4">
        <Card className="flex items-center justify-between p-4">
          <div>
            <p className="text-body-sm text-sand-800 font-medium">{order.payment_method} payment</p>
            <p className="text-caption text-sand-600">
              COD collection and order status are tracked independently.
            </p>
          </div>
          <Badge tone={order.payment_status === 'PAID' ? 'success' : 'neutral'}>
            {order.payment_status === 'PAID' ? 'Collected' : 'Due on delivery'}
          </Badge>
        </Card>
      </section>

      <section className="mt-4">
        <Card className="flex items-center justify-between p-4">
          <div>
            <p className="text-body-sm text-sand-800 font-medium">Delivery partner</p>
            {order.assigned_partner_name ? (
              <p className="text-caption text-sand-600">
                {order.assigned_partner_name}
                {order.assigned_at
                  ? ` · assigned ${new Date(order.assigned_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}`
                  : ''}
              </p>
            ) : (
              <p className="text-caption text-sand-600">Not yet assigned.</p>
            )}
          </div>
          {ASSIGNABLE_STATUSES.has(order.status) ? (
            <Button size="sm" variant="secondary" onClick={() => void openAssignDialog()}>
              {isReassignment ? 'Reassign' : 'Assign'}
            </Button>
          ) : null}
        </Card>
      </section>

      {order.cancellation_reason ? (
        <p className="text-body-sm text-danger-600 mt-4">
          Cancellation reason: {order.cancellation_reason}
        </p>
      ) : null}

      {order.internal_note ? (
        <Card className="bg-warning-50 mt-4 border-none p-4">
          <p className="text-caption text-warning-600 font-semibold uppercase">
            Internal note — never shown to the customer
          </p>
          <p className="text-body-sm text-sand-800 mt-1 whitespace-pre-line">
            {order.internal_note}
          </p>
        </Card>
      ) : null}

      {actionError ? (
        <p role="alert" className="text-body-sm text-danger-600 mt-4">
          {actionError}
        </p>
      ) : null}

      <div className="mt-6 flex flex-wrap gap-3">
        {next ? (
          <Button
            isLoading={isBusy}
            onClick={() =>
              void runAction(() =>
                apiClient.updateAdminOrderStatus(order.id, { to_status: next.to }),
              )
            }
          >
            {next.label}
          </Button>
        ) : null}
        {canMarkDeliveryFailed(order.status) ? (
          <Button variant="secondary" onClick={() => setDialog('fail')}>
            Mark delivery failed
          </Button>
        ) : null}
        {canRecordCodCollection(order.status) && order.payment_status !== 'PAID' ? (
          <Button variant="secondary" onClick={() => setDialog('collect')}>
            Record COD collection
          </Button>
        ) : null}
        {canHold(order.status) ? (
          <Button variant="secondary" onClick={() => setDialog('hold')}>
            Hold for review
          </Button>
        ) : null}
        {canReject(order.status) ? (
          <Button variant="danger" onClick={() => setDialog('reject')}>
            Reject order
          </Button>
        ) : null}
      </div>

      {dialog ? (
        <Card className="mt-5 p-4">
          <form onSubmit={onDialogSubmit} className="space-y-3">
            {dialog === 'collect' ? (
              <p className="text-body-sm text-sand-700">
                Confirm that <strong>{order.total.display}</strong> was collected in cash/UPI from
                the customer on delivery.
              </p>
            ) : dialog === 'assign' ? (
              <>
                <label htmlFor="assign-partner" className="text-body-sm text-sand-700 font-medium">
                  On-duty delivery partner
                </label>
                {eligiblePartners === null ? (
                  <p className="text-caption text-sand-600">Loading eligible partners…</p>
                ) : eligiblePartners.length === 0 ? (
                  <p className="text-caption text-danger-600">
                    No on-duty, active delivery partners available right now.
                  </p>
                ) : (
                  <select
                    id="assign-partner"
                    required
                    value={selectedPartnerId}
                    onChange={(e) => setSelectedPartnerId(e.target.value)}
                    className="border-sand-200 bg-sand-0 text-body-sm h-10 w-full rounded-md border px-3"
                  >
                    <option value="" disabled>
                      Select a partner
                    </option>
                    {eligiblePartners.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.full_name}
                        {p.active_delivery_count > 0 ? ` (${p.active_delivery_count} active)` : ''}
                      </option>
                    ))}
                  </select>
                )}
                {isReassignment ? (
                  <>
                    <label
                      htmlFor="assign-reason"
                      className="text-body-sm text-sand-700 mt-2 block font-medium"
                    >
                      Reason for reassigning
                    </label>
                    <textarea
                      id="assign-reason"
                      required
                      value={reasonText}
                      onChange={(e) => setReasonText(e.target.value)}
                      maxLength={500}
                      className="border-sand-200 bg-sand-0 text-body-sm h-20 w-full rounded-md border px-3 py-2"
                    />
                  </>
                ) : null}
              </>
            ) : (
              <>
                <label htmlFor="dialog-reason" className="text-body-sm text-sand-700 font-medium">
                  {dialog === 'reject'
                    ? 'Reason for rejecting this order'
                    : dialog === 'fail'
                      ? 'Reason delivery failed'
                      : 'Note for follow-up'}
                </label>
                <textarea
                  id="dialog-reason"
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
                variant={dialog === 'reject' ? 'danger' : 'primary'}
                isLoading={isBusy}
                disabled={dialog === 'assign' && !selectedPartnerId}
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
