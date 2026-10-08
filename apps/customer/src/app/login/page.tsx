'use client';

import { ApiError } from '@healthy-aahar/sdk';
import { Button } from '@healthy-aahar/ui';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { apiClient } from '@/lib/api-client';
import { setSessionToken } from '@/lib/session-store';

/**
 * Customer sign-in / sign-up (PHASE 03 — email/password, docs/07 §4).
 *
 * The session token returned by the API is held only in memory
 * (`lib/session-store.ts`) — never `localStorage`, `sessionStorage`, or a
 * cookie this app sets itself.
 */
export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const result =
        mode === 'login'
          ? await apiClient.customerLogin({ email, password })
          : await apiClient.customerRegister({ email, password });

      setSessionToken(result.token);
      router.push('/');
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'RATE_LIMITED') {
          setError('Too many attempts. Please wait a moment and try again.');
        } else if (err.code === 'EMAIL_ALREADY_REGISTERED') {
          setError('An account with this email already exists. Try signing in instead.');
        } else if (err.code === 'VALIDATION_FAILED') {
          setError(err.message);
        } else {
          // INVALID_CREDENTIALS and anything else: one generic message,
          // same as the server's own collapsing of failure reasons.
          setError('Incorrect email or password.');
        }
      } else {
        setError('Something went wrong. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4">
      <p className="text-caption font-semibold uppercase tracking-wide text-green-600">
        Healthy Aahar
      </p>
      <h1 className="font-display text-heading-lg text-sand-900 mt-2">
        {mode === 'login' ? 'Sign in' : 'Create your account'}
      </h1>

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
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            required
            minLength={mode === 'register' ? 10 : 1}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="border-sand-200 bg-sand-0 text-body-md mt-1 h-11 w-full rounded-md border px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600"
          />
          {mode === 'register' ? (
            <p className="text-caption text-sand-400 mt-1">At least 10 characters.</p>
          ) : null}
        </div>

        {error ? (
          <p role="alert" className="text-body-sm text-danger-600">
            {error}
          </p>
        ) : null}

        <Button type="submit" size="lg" className="w-full" isLoading={isSubmitting}>
          {mode === 'login' ? 'Sign in' : 'Create account'}
        </Button>
      </form>

      <button
        type="button"
        onClick={() => {
          setMode(mode === 'login' ? 'register' : 'login');
          setError(null);
        }}
        className="text-body-sm text-green-600 mt-4 text-center hover:underline"
      >
        {mode === 'login' ? "Don't have an account? Create one" : 'Already have an account? Sign in'}
      </button>
    </main>
  );
}
