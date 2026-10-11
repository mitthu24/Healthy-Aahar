'use client';

import { ApiError } from '@healthy-aahar/sdk';
import { Button, Card, FieldError, FieldLabel, Input } from '@healthy-aahar/ui';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { apiClient } from '@/lib/api-client';

/**
 * Self-service password change (Phase 04) — requires the CURRENT password,
 * distinct from an admin resetting someone else's password. A demo account
 * bootstrapped with no password-change history is routed here from login
 * (`AdminMe.must_change_password`) before it can reach anything else.
 *
 * On success the server revokes every session (this one included), so the
 * only place left to go is back to /login.
 */
export default function ChangePasswordPage() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }

    setIsSubmitting(true);
    try {
      await apiClient.adminChangePassword({
        current_password: currentPassword,
        new_password: newPassword,
      });
      router.push('/login?changed=1');
    } catch (err) {
      if (err instanceof ApiError) {
        setError(
          err.code === 'INVALID_CREDENTIALS' ? 'Current password is incorrect.' : err.message,
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
        Healthy Aahar Operations
      </p>
      <h1 className="font-display text-heading-lg text-sand-900 mt-2">Change your password</h1>
      <p className="text-body-sm text-sand-600 mt-2">
        For security, you must set a new password before continuing.
      </p>

      <Card className="mt-6 p-5">
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div>
            <FieldLabel htmlFor="current_password">Current password</FieldLabel>
            <Input
              id="current_password"
              type="password"
              autoComplete="current-password"
              required
              className="mt-1"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>
          <div>
            <FieldLabel htmlFor="new_password">New password</FieldLabel>
            <Input
              id="new_password"
              type="password"
              autoComplete="new-password"
              required
              minLength={10}
              className="mt-1"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
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
            Change password
          </Button>
        </form>
      </Card>
    </main>
  );
}
