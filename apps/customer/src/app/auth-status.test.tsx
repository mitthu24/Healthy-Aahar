import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setSessionToken } from '@/lib/session-store';

import { AuthStatus } from './auth-status.js';

/** Regression coverage: logout must clear BOTH the in-memory token and the
 *  persisted cookie (`clearPersistedSessionToken`), not just the in-memory
 *  one — otherwise a stale cookie would sign the user back in on reload. */

const push = vi.fn();
const customerLogout = vi.fn();
const clearPersistedSessionToken = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

vi.mock('@/lib/api-client', () => ({
  apiClient: { customerLogout: (...args: unknown[]) => customerLogout(...args) },
}));

vi.mock('@/lib/session-client', () => ({
  clearPersistedSessionToken: (...args: unknown[]) => clearPersistedSessionToken(...args),
}));

beforeEach(() => {
  push.mockClear();
  customerLogout.mockReset().mockResolvedValue({ signed_out: true });
  clearPersistedSessionToken.mockReset();
  setSessionToken('tok-active');
});

afterEach(() => {
  setSessionToken(null);
});

describe('AuthStatus', () => {
  it('shows "Sign in" when there is no session', async () => {
    setSessionToken(null);
    render(<AuthStatus />);

    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('shows "Sign out" when a session is present', async () => {
    render(<AuthStatus />);

    expect(await screen.findByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('logout and session invalidation: clicking sign out clears the persisted session, not just the in-memory one', async () => {
    render(<AuthStatus />);

    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));

    await waitFor(() => expect(customerLogout).toHaveBeenCalled());
    expect(clearPersistedSessionToken).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith('/login');
  });

  it('still clears the session locally even if the server logout call fails', async () => {
    customerLogout.mockRejectedValue(new Error('network error'));
    render(<AuthStatus />);

    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));

    await waitFor(() => expect(clearPersistedSessionToken).toHaveBeenCalledTimes(1));
  });
});
