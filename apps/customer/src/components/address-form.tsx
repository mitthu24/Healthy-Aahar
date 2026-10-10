'use client';

import type { AddressDto } from '@healthy-aahar/sdk';
import { ApiError } from '@healthy-aahar/sdk';
import { Button, FieldError, FieldLabel, Input } from '@healthy-aahar/ui';
import { useState, type FormEvent } from 'react';

import { apiClient } from '@/lib/api-client';

export function AddressForm({
  initial,
  onSaved,
  onCancel,
}: {
  initial?: AddressDto;
  onSaved: (address: AddressDto) => void;
  onCancel?: () => void;
}) {
  const [recipientName, setRecipientName] = useState(initial?.recipient_name ?? '');
  const [recipientPhone, setRecipientPhone] = useState(initial?.recipient_phone ?? '');
  const [line1, setLine1] = useState(initial?.line1 ?? '');
  const [line2, setLine2] = useState(initial?.line2 ?? '');
  const [city, setCity] = useState(initial?.city ?? '');
  const [state, setState] = useState(initial?.state ?? '');
  const [pincode, setPincode] = useState(initial?.pincode ?? '');
  const [deliveryInstructions, setDeliveryInstructions] = useState(
    initial?.delivery_instructions ?? '',
  );
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const body = {
      recipient_name: recipientName,
      recipient_phone: recipientPhone,
      line1,
      line2: line2 || undefined,
      city,
      state,
      pincode,
      delivery_instructions: deliveryInstructions || undefined,
    };

    try {
      const saved = initial
        ? await apiClient.updateAddress(initial.id, body)
        : await apiClient.createAddress(body);
      onSaved(saved);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save this address.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div>
        <FieldLabel htmlFor="recipient_name">Recipient name</FieldLabel>
        <Input
          id="recipient_name"
          required
          className="mt-1"
          value={recipientName}
          onChange={(e) => setRecipientName(e.target.value)}
        />
      </div>
      <div>
        <FieldLabel htmlFor="recipient_phone">Phone</FieldLabel>
        <Input
          id="recipient_phone"
          type="tel"
          required
          placeholder="+919876543210"
          className="mt-1"
          value={recipientPhone}
          onChange={(e) => setRecipientPhone(e.target.value)}
        />
      </div>
      <div>
        <FieldLabel htmlFor="line1">Address line 1</FieldLabel>
        <Input
          id="line1"
          required
          className="mt-1"
          value={line1}
          onChange={(e) => setLine1(e.target.value)}
        />
      </div>
      <div>
        <FieldLabel htmlFor="line2">Address line 2 (optional)</FieldLabel>
        <Input
          id="line2"
          className="mt-1"
          value={line2}
          onChange={(e) => setLine2(e.target.value)}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <FieldLabel htmlFor="city">City</FieldLabel>
          <Input
            id="city"
            required
            className="mt-1"
            value={city}
            onChange={(e) => setCity(e.target.value)}
          />
        </div>
        <div>
          <FieldLabel htmlFor="state">State</FieldLabel>
          <Input
            id="state"
            required
            className="mt-1"
            value={state}
            onChange={(e) => setState(e.target.value)}
          />
        </div>
      </div>
      <div>
        <FieldLabel htmlFor="pincode">Pincode</FieldLabel>
        <Input
          id="pincode"
          required
          inputMode="numeric"
          pattern="[1-9][0-9]{5}"
          className="mt-1"
          value={pincode}
          onChange={(e) => setPincode(e.target.value)}
        />
      </div>
      <div>
        <FieldLabel htmlFor="delivery_instructions">Delivery instructions (optional)</FieldLabel>
        <Input
          id="delivery_instructions"
          className="mt-1"
          value={deliveryInstructions}
          onChange={(e) => setDeliveryInstructions(e.target.value)}
        />
      </div>

      <FieldError>{error}</FieldError>

      <div className="flex gap-3 pt-2">
        <Button type="submit" isLoading={isSubmitting} className="flex-1">
          Save address
        </Button>
        {onCancel ? (
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}
