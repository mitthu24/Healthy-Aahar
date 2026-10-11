'use client';

import { useState, type FormEvent } from 'react';

import { ApiError, type ServiceabilityResponse } from '@healthy-aahar/sdk';
import { Button, Input } from '@healthy-aahar/ui';

import { apiClient } from '@/lib/api-client';

import { CheckCircleIcon, PinIcon } from './icons';

/**
 * The hero's real conversion element (docs/16 §4) — checks
 * GET /v1/public/serviceability live, no hard-coded pincode list (BR-MK2).
 */
export function PincodeChecker({ id, className }: { id?: string; className?: string }) {
  const [pincode, setPincode] = useState('');
  const [result, setResult] = useState<ServiceabilityResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setResult(null);

    if (!/^\d{6}$/.test(pincode)) {
      setError('Enter a valid 6-digit pincode.');
      return;
    }

    setIsChecking(true);
    try {
      const res = await apiClient.checkServiceability(pincode);
      setResult(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not check that pincode right now.');
    } finally {
      setIsChecking(false);
    }
  }

  return (
    <div id={id} className={className}>
      <form onSubmit={onSubmit} className="flex flex-col gap-2 sm:flex-row" noValidate>
        <label htmlFor="pincode" className="sr-only">
          Delivery pincode
        </label>
        <div className="relative flex-1">
          <PinIcon className="text-sand-400 pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2" />
          <Input
            id="pincode"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            placeholder="Enter your pincode"
            value={pincode}
            onChange={(e) => setPincode(e.target.value.replace(/\D/g, ''))}
            className="h-13 pl-10"
            aria-describedby={error ? 'pincode-error' : result ? 'pincode-result' : undefined}
          />
        </div>
        <Button type="submit" size="lg" isLoading={isChecking} className="sm:w-auto">
          Check delivery
        </Button>
      </form>

      {error ? (
        <p id="pincode-error" role="alert" className="text-body-sm text-danger-600 mt-2">
          {error}
        </p>
      ) : null}

      {result ? (
        <p
          id="pincode-result"
          role="status"
          className={
            'text-body-sm mt-2 flex items-center gap-1.5 font-medium ' +
            (result.is_serviceable ? 'text-success-600' : 'text-sand-600')
          }
        >
          {result.is_serviceable ? <CheckCircleIcon className="h-4 w-4 shrink-0" /> : null}
          {result.message}
        </p>
      ) : null}
    </div>
  );
}
