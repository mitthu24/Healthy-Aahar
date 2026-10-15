'use client';

import { ApiError } from '@healthy-aahar/sdk';
import { Button } from '@healthy-aahar/ui';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { apiClient } from '@/lib/api-client';

/**
 * Admin sign-in (PHASE 03 — email/password, docs/07 §5.1; Stage C adds
 * login-ID support).
 *
 * A successful login sets the `__Host-admin_session` cookie server-side;
 * this page never sees, stores or echoes the session value itself — it
 * only reads the API's success/failure response.
 *
 * The identifier field accepts either a registered email or a Stage C
 * login ID (for an email-free staff/delivery account) — deliberately
 * `type="text"`, not `type="email"`, since a login ID is never
 * email-shaped and the browser's own email validation would block it.
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
      router.push(me.must_change_password ? '/change-password' : '/orders');
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        // Generic message regardless of which check failed server-side
        // (unknown email, no password set yet, wrong password, suspended)
        // — the API already collapses these into one code; the UI must
        // not re-introduce a distinction by branching on `err.message`.
        if (err.code === 'RATE_LIMITED') {
          setError('Too many attempts. Please wait a moment and try again.');
        } else {
          setError('Incorrect email/login ID or password.');
        }
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
        Healthy Aahar Operations
      </p>
      <h1 className="font-display text-heading-lg text-sand-900 mt-2">Sign in</h1>

      <form onSubmit={onSubmit} className="mt-8 space-y-4" noValidate>
        <div>
          <label htmlFor="email" className="text-body-sm text-sand-700 font-medium">
            Email or Login ID
          </label>
          <input
            id="email"
            name="email"
            type="text"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="border-sand-200 bg-sand-0 text-body-md mt-1 h-11 w-full rounded-md border px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600"
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
            className="border-sand-200 bg-sand-0 text-body-md mt-1 h-11 w-full rounded-md border px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600"
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
