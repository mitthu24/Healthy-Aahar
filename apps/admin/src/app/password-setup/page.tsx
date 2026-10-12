'use client';

import { ApiError } from '@healthy-aahar/sdk';
import { Button, Card, FieldError, FieldLabel, Input } from '@healthy-aahar/ui';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';

import { apiClient } from '@/lib/api-client';

/**
 * One-time password setup (Phase 04) — the page a freshly invited or
 * bootstrapped admin lands on via the `?token=` link `PasswordResetService
 * .issueToken` mints (docs/07 §5.1). Unauthenticated by design: the token
 * itself identifies the account, not a session.
 *
 * The token is read from the URL and sent with the one POST this page ever
 * makes — it is never written to `localStorage`, `sessionStorage`, or any
 * state that outlives this page load. A successful setup consumes the
 * token server-side (single-use) and does NOT establish a session (the API
 * route returns `{ ok: true }` only, no cookie) — this mirrors the
 * self-service change-password flow, which also ends at `/login` rather
 * than silently signing the caller in.
 */
function PasswordSetupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!token) {
    return (
      <p role="alert" className="text-body-sm text-danger-600">
        This link is missing its setup token. Use the exact link you were given, or ask a Super
        Admin for a new one.
      </p>
    );
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }

    setIsSubmitting(true);
    try {
      await apiClient.passwordSetup({ token, password });
      router.push('/login?setup=1');
    } catch (err) {
      if (err instanceof ApiError) {
        setError(
          err.code === 'PASSWORD_SETUP_TOKEN_INVALID'
            ? 'This link is invalid, already used, or has expired. Ask a Super Admin for a new one.'
            : err.code === 'WEAK_PASSWORD'
              ? err.message
              : err.code === 'RATE_LIMITED'
                ? 'Too many attempts. Please wait a moment and try again.'
                : err.message,
        );
      } else {
        setError('Something went wrong. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div>
        <FieldLabel htmlFor="password">New password</FieldLabel>
        <Input
          id="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          className="mt-1"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <p className="text-caption text-sand-400 mt-1">At least 10 characters.</p>
      </div>
      <div>
        <FieldLabel htmlFor="confirm_password">Confirm new password</FieldLabel>
        <Input
          id="confirm_password"
          type="password"
          autoComplete="new-password"
          required
          className="mt-1"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
        />
      </div>

      <FieldError>{error}</FieldError>

      <Button type="submit" size="lg" className="w-full" isLoading={isSubmitting}>
        Set password
      </Button>
    </form>
  );
}

export default function PasswordSetupPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6">
      <p className="text-caption font-semibold uppercase tracking-wide text-green-600">
        Healthy Aahar Operations
      </p>
      <h1 className="font-display text-heading-lg text-sand-900 mt-2">Set your password</h1>
      <p className="text-body-sm text-sand-600 mt-2">
        Choose a password to finish setting up your account.
      </p>

      <Card className="mt-6 p-5">
        {/* useSearchParams requires a Suspense boundary in the app router. */}
        <Suspense fallback={null}>
          <PasswordSetupForm />
        </Suspense>
      </Card>
    </main>
  );
}
