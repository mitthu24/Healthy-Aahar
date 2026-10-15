import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import LoginPage from './page.js';

/**
 * Regression coverage: "successful login -> redirect to the admin
 * dashboard" (PHASE 04 hotfix). This behavior was never broken by
 * PR #13's middleware bug — the bug only prevented that destination page
 * from rendering afterward — but it is the other half of the same user
 * journey `AuthGate`'s tests cover, so it's included here for the full
 * login-to-dashboard flow.
 */

const push = vi.fn();
const refresh = vi.fn();
const adminLogin = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh, replace: vi.fn() }),
}));

vi.mock('@/lib/api-client', () => ({
  apiClient: { adminLogin: (...args: unknown[]) => adminLogin(...args) },
}));

beforeEach(() => {
  push.mockClear();
  refresh.mockClear();
  adminLogin.mockReset();
});

function fillAndSubmit() {
  fireEvent.change(screen.getByLabelText('Email or Login ID'), {
    target: { value: 'admin@gmail.com' },
  });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'a-real-password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('LoginPage', () => {
  it('successful login redirects to the admin dashboard (/orders) and refreshes router state', async () => {
    adminLogin.mockResolvedValue({ full_name: 'Test Admin', must_change_password: false });

    render(<LoginPage />);
    fillAndSubmit();

    await waitFor(() => expect(push).toHaveBeenCalledWith('/orders'));
    expect(refresh).toHaveBeenCalled();
  });

  it('a first-login (must_change_password) account is redirected to /change-password instead', async () => {
    adminLogin.mockResolvedValue({ full_name: 'Test Admin', must_change_password: true });

    render(<LoginPage />);
    fillAndSubmit();

    await waitFor(() => expect(push).toHaveBeenCalledWith('/change-password'));
  });

  it('does not navigate anywhere on a failed login', async () => {
    adminLogin.mockRejectedValue(new Error('invalid credentials'));

    render(<LoginPage />);
    fillAndSubmit();

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(push).not.toHaveBeenCalled();
  });
});
