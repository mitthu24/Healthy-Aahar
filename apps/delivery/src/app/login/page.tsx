'use client';

import { ApiError } from '@healthy-aahar/sdk';
import { Button } from '@healthy-aahar/ui';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { apiClient } from '@/lib/api-client';

/**
 * Delivery partner sign-in. Same credential/session flow as apps/admin
 * (`POST /v1/admin/auth/login`) — a partner is just an AdminUser with the
 * DELIVERY_PARTNER role, so there is no separate auth stack to build.
 */
export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const me = await apiClient.adminLogin({ email, password });
      if (!me.permissions.includes('deliveries:fulfil')) {
        setError('This account is not set up as a delivery partner.');
        await apiClient.adminLogout();
        return;
      }
      router.push('/');
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(
          err.code === 'RATE_LIMITED'
            ? 'Too many attempts. Please wait a moment and try again.'
            : 'Incorrect email or password.',
        );
      } else {
        setError('Something went wrong. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6">
      <p className="text-caption font-semibold uppercase tracking-wide text-green-600">
        Healthy Aahar
      </p>
      <h1 className="font-display text-heading-lg text-sand-900 mt-2">Delivery sign in</h1>

      <form onSubmit={onSubmit} className="mt-8 space-y-4" noValidate>
        <div>
          <label htmlFor="email" className="text-body-sm text-sand-700 font-medium">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="border-sand-200 bg-sand-0 text-body-md mt-1 h-12 w-full rounded-md border px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600"
          />
        </div>

        <div>
          <label htmlFor="password" className="text-body-sm text-sand-700 font-medium">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            minLength={1}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="border-sand-200 bg-sand-0 text-body-md mt-1 h-12 w-full rounded-md border px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600"
          />
        </div>

        {error ? (
          <p role="alert" className="text-body-sm text-danger-600">
            {error}
          </p>
        ) : null}

        <Button type="submit" size="lg" className="w-full" isLoading={isSubmitting}>
          Sign in
        </Button>
      </form>
    </main>
  );
}
