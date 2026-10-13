'use client';

import type { AdminDeliverySlotDto } from '@healthy-aahar/sdk';
import { ApiError } from '@healthy-aahar/sdk';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  FieldError,
  FieldLabel,
  Input,
  Skeleton,
} from '@healthy-aahar/ui';
import { useEffect, useState, type FormEvent } from 'react';

import { apiClient } from '@/lib/api-client';

const WEEKDAY_LABELS: Record<number, string> = {
  1: 'Mon',
  2: 'Tue',
  3: 'Wed',
  4: 'Thu',
  5: 'Fri',
  6: 'Sat',
  7: 'Sun',
};
const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];

function slugifyCode(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function DeliverySlotForm({
  initial,
  onSaved,
  onCancel,
}: {
  initial?: AdminDeliverySlotDto;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [code, setCode] = useState(initial?.code ?? '');
  const [codeEdited, setCodeEdited] = useState(Boolean(initial));
  const [startTime, setStartTime] = useState(initial?.start_time ?? '');
  const [endTime, setEndTime] = useState(initial?.end_time ?? '');
  const [availableDays, setAvailableDays] = useState<number[]>(initial?.available_days ?? ALL_DAYS);
  const [capacity, setCapacity] = useState(String(initial?.default_capacity ?? 20));
  const [deliveryFeeRupees, setDeliveryFeeRupees] = useState(
    initial?.delivery_fee ? String(initial.delivery_fee.amount_paise / 100) : '',
  );
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function toggleDay(day: number) {
    setAvailableDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort(),
    );
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (availableDays.length === 0) {
      setError('Select at least one available day.');
      return;
    }

    setIsSubmitting(true);
    try {
      const deliveryFeePaise =
        deliveryFeeRupees.trim() === '' ? undefined : Math.round(Number(deliveryFeeRupees) * 100);

      if (initial) {
        await apiClient.updateDeliverySlot(initial.id, {
          name,
          start_time: startTime,
          end_time: endTime,
          available_days: availableDays,
          default_capacity: Number(capacity),
          delivery_fee_paise: deliveryFeePaise ?? null,
        });
      } else {
        await apiClient.createDeliverySlot({
          name,
          code,
          start_time: startTime,
          end_time: endTime,
          available_days: availableDays,
          default_capacity: Number(capacity),
          delivery_fee_paise: deliveryFeePaise,
        });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save this delivery slot.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <FieldLabel htmlFor="slot-name">Label</FieldLabel>
        <Input
          id="slot-name"
          required
          className="mt-1"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (!codeEdited) setCode(slugifyCode(e.target.value));
          }}
        />
      </div>
      <div>
        <FieldLabel htmlFor="slot-code">Code</FieldLabel>
        <Input
          id="slot-code"
          required
          disabled={Boolean(initial)}
          className="mt-1"
          value={code}
          onChange={(e) => {
            setCode(slugifyCode(e.target.value));
            setCodeEdited(true);
          }}
        />
        {initial ? (
          <p className="text-caption text-sand-500 mt-1">Code cannot be changed after creation.</p>
        ) : null}
      </div>
      <div className="flex gap-4">
        <div className="flex-1">
          <FieldLabel htmlFor="slot-start">Start time</FieldLabel>
          <Input
            id="slot-start"
            type="time"
            required
            className="mt-1"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
          />
        </div>
        <div className="flex-1">
          <FieldLabel htmlFor="slot-end">End time</FieldLabel>
          <Input
            id="slot-end"
            type="time"
            required
            className="mt-1"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
          />
        </div>
      </div>
      <div>
        <FieldLabel>Available days</FieldLabel>
        <div className="mt-1 flex flex-wrap gap-2">
          {ALL_DAYS.map((day) => (
            <button
              key={day}
              type="button"
              onClick={() => toggleDay(day)}
              className={`text-body-sm min-h-9 rounded-md border px-3 ${
                availableDays.includes(day)
                  ? 'border-green-600 bg-green-50 text-green-700'
                  : 'border-sand-200 text-sand-600'
              }`}
            >
              {WEEKDAY_LABELS[day]}
            </button>
          ))}
        </div>
      </div>
      <div className="flex gap-4">
        <div className="flex-1">
          <FieldLabel htmlFor="slot-capacity">Capacity (orders)</FieldLabel>
          <Input
            id="slot-capacity"
            type="number"
            min={1}
            required
            className="mt-1"
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
          />
        </div>
        <div className="flex-1">
          <FieldLabel htmlFor="slot-fee">Delivery fee (Rs, optional)</FieldLabel>
          <Input
            id="slot-fee"
            type="number"
            min={0}
            step="0.01"
            className="mt-1"
            value={deliveryFeeRupees}
            onChange={(e) => setDeliveryFeeRupees(e.target.value)}
          />
        </div>
      </div>

      <FieldError>{error}</FieldError>

      <div className="flex gap-3">
        <Button type="submit" isLoading={isSubmitting}>
          {initial ? 'Save changes' : 'Create slot'}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export default function DeliverySlotsPage() {
  const [slots, setSlots] = useState<AdminDeliverySlotDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<AdminDeliverySlotDto | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const result = await apiClient.listAdminDeliverySlots();
      setSlots(result.data);
    } catch {
      setError('Could not load delivery slots.');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function toggleActive(slot: AdminDeliverySlotDto) {
    setStatusError(null);
    try {
      await apiClient.updateDeliverySlot(slot.id, { is_active: !slot.is_active });
      void load();
    } catch (err) {
      setStatusError(err instanceof ApiError ? err.message : 'Could not update this slot.');
    }
  }

  if (error) return <ErrorState message={error} onRetry={() => void load()} />;

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <div className="flex items-baseline justify-between">
        <h1 className="font-display text-heading-lg text-sand-900">Delivery slots</h1>
        {!showCreate ? (
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setShowCreate(true);
            }}
          >
            New slot
          </Button>
        ) : null}
      </div>
      <p className="text-body-sm text-sand-600 mt-1">
        Customers choose one of these windows at checkout. Deactivating a slot hides it from
        checkout without deleting its history.
      </p>

      {showCreate ? (
        <Card className="mt-5 p-5">
          <h2 className="text-heading-sm text-sand-900">
            {editing ? 'Edit delivery slot' : 'New delivery slot'}
          </h2>
          <div className="mt-4">
            <DeliverySlotForm
              initial={editing ?? undefined}
              onCancel={() => setShowCreate(false)}
              onSaved={() => {
                setShowCreate(false);
                void load();
              }}
            />
          </div>
        </Card>
      ) : null}

      {statusError ? <p className="text-body-sm text-danger-600 mt-4">{statusError}</p> : null}

      <div className="mt-6 space-y-3">
        {slots === null ? (
          Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)
        ) : slots.length === 0 && !showCreate ? (
          <EmptyState
            title="No delivery slots yet"
            description="Create one so customers can check out."
          />
        ) : (
          slots.map((slot) => (
            <Card key={slot.id} className="flex items-center justify-between p-4">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-body-sm text-sand-900 font-semibold">{slot.name}</p>
                  {!slot.is_active ? <Badge tone="neutral">Inactive</Badge> : null}
                </div>
                <p className="text-caption text-sand-600 mt-0.5">
                  {slot.start_time}–{slot.end_time} · capacity {slot.default_capacity} ·{' '}
                  {slot.available_days
                    .slice()
                    .sort()
                    .map((d) => WEEKDAY_LABELS[d])
                    .join(', ')}
                  {slot.delivery_fee ? ` · ${slot.delivery_fee.display} delivery fee` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="secondary" onClick={() => void toggleActive(slot)}>
                  {slot.is_active ? 'Deactivate' : 'Activate'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setEditing(slot);
                    setShowCreate(true);
                  }}
                >
                  Edit
                </Button>
              </div>
            </Card>
          ))
        )}
      </div>
    </main>
  );
}
