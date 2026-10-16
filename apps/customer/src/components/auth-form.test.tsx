import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthForm } from './auth-form.js';

/**
 * Regression coverage: login/register must persist the returned token
 * (`persistSessionToken`, which both updates the in-memory store AND
 * writes the HttpOnly cookie) rather than only `setSessionToken` (in-memory
 * only, lost on the next reload — the bug this fix closes).
 */

const push = vi.fn();
const replace = vi.fn();
const customerLogin = vi.fn();
const customerRegister = vi.fn();
const persistSessionToken = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    customerLogin: (...args: unknown[]) => customerLogin(...args),
    customerRegister: (...args: unknown[]) => customerRegister(...args),
  },
}));

vi.mock('@/lib/session-client', () => ({
  persistSessionToken: (...args: unknown[]) => persistSessionToken(...args),
}));

beforeEach(() => {
  push.mockClear();
  replace.mockClear();
  customerLogin.mockReset();
  customerRegister.mockReset();
  persistSessionToken.mockReset();
});

function fillAndSubmit() {
  fireEvent.change(screen.getByLabelText('Email'), {
    target: { value: 'customer@example.test' },
  });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'a-real-password' } });
  fireEvent.click(document.querySelector('button[type="submit"]')!);
}

describe('AuthForm', () => {
  it('login: persists the returned token (not just in-memory) and navigates home', async () => {
    customerLogin.mockResolvedValue({
      user: { id: 'u1', email: 'customer@example.test', phone: null, status: 'ACTIVE' },
      profile: { id: 'p1', first_name: null, last_name: null, display_name: null },
      token: 'tok-login-abc',
    });

    render(<AuthForm initialMode="login" />);
    fillAndSubmit();

    await waitFor(() => expect(persistSessionToken).toHaveBeenCalledWith('tok-login-abc'));
    expect(push).toHaveBeenCalledWith('/');
  });

  it('registration: persists the returned token the same way as login', async () => {
    customerRegister.mockResolvedValue({
      user: { id: 'u2', email: 'customer@example.test', phone: null, status: 'ACTIVE' },
      profile: { id: 'p2', first_name: null, last_name: null, display_name: null },
      token: 'tok-register-xyz',
    });

    render(<AuthForm initialMode="register" />);
    fillAndSubmit();

    await waitFor(() => expect(persistSessionToken).toHaveBeenCalledWith('tok-register-xyz'));
    expect(push).toHaveBeenCalledWith('/');
  });

  it('a failed login does not persist anything', async () => {
    customerLogin.mockRejectedValue(new Error('Incorrect email or password.'));

    render(<AuthForm initialMode="login" />);
    fillAndSubmit();

    await waitFor(() => expect(customerLogin).toHaveBeenCalled());
    expect(persistSessionToken).not.toHaveBeenCalled();
  });
});
