import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthStatus } from './auth-status.js';

/** Regression coverage: "logout" (PHASE 04 hotfix requirement). */

const push = vi.fn();
const refresh = vi.fn();
const adminMe = vi.fn();
const adminLogout = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh, replace: vi.fn() }),
  usePathname: () => '/orders',
}));

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    adminMe: () => adminMe(),
    adminLogout: () => adminLogout(),
  },
}));

beforeEach(() => {
  push.mockClear();
  refresh.mockClear();
  adminMe.mockReset();
  adminLogout.mockReset();
});

describe('AuthStatus', () => {
  it('signing out calls the API logout endpoint and navigates to /login', async () => {
    adminMe.mockResolvedValue({ full_name: 'Test Admin', must_change_password: false });
    adminLogout.mockResolvedValue({ signed_out: true });

    render(<AuthStatus />);

    const signOut = await screen.findByRole('button', { name: 'Sign out' });
    fireEvent.click(signOut);

    await waitFor(() => expect(adminLogout).toHaveBeenCalled());
    expect(push).toHaveBeenCalledWith('/login');
    expect(refresh).toHaveBeenCalled();
  });

  it('unauthenticated access: shows a Sign in action, not a signed-in state', async () => {
    adminMe.mockRejectedValue(new Error('UNAUTHENTICATED'));

    render(<AuthStatus />);

    await screen.findByRole('button', { name: 'Sign in' });
    expect(screen.queryByText(/Signed in as/)).not.toBeInTheDocument();
  });
});
