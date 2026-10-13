import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthGate } from './auth-gate.js';

/**
 * Regression coverage for the PHASE 04 hotfix: `middleware.ts` checked
 * for the `__Host-admin_session` cookie on the request to THIS app's own
 * origin, but that cookie is scoped to the API's origin — a browser never
 * attaches it there, so every protected-route load (including right
 * after a successful login) was redirected back to `/login`. `AuthGate`
 * replaces that broken check with a client-side call to the API's own
 * `/v1/admin/auth/me`, which DOES carry the cookie correctly (it targets
 * the cookie's own origin).
 */

const replace = vi.fn();
const adminMe = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/orders',
}));

vi.mock('@/lib/api-client', () => ({
  apiClient: { adminMe: () => adminMe() },
}));

beforeEach(() => {
  replace.mockClear();
  adminMe.mockReset();
});

describe('AuthGate', () => {
  it('unauthenticated access: redirects to /login rather than rendering protected content', async () => {
    adminMe.mockRejectedValue(new Error('UNAUTHENTICATED'));

    render(
      <AuthGate>
        <p>Dashboard content</p>
      </AuthGate>,
    );

    // The gate never renders the protected children for an unauthenticated visitor.
    expect(screen.queryByText('Dashboard content')).not.toBeInTheDocument();

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
    expect(screen.queryByText('Dashboard content')).not.toBeInTheDocument();
  });

  it('successful login / refresh after login: an authenticated session renders the protected dashboard, not a redirect loop', async () => {
    // This is exactly the scenario the old middleware got wrong: a session
    // that genuinely exists (the API confirms it via /v1/admin/auth/me,
    // the only place the cross-origin cookie is actually visible) must
    // render the page, not bounce back to /login.
    adminMe.mockResolvedValue({
      full_name: 'Test Admin',
      must_change_password: false,
    });

    render(
      <AuthGate>
        <p>Dashboard content</p>
      </AuthGate>,
    );

    await waitFor(() => expect(screen.getByText('Dashboard content')).toBeInTheDocument());
    expect(replace).not.toHaveBeenCalled();
  });

  it('shows a loading state (not protected content, not an immediate redirect) while the session check is in flight', () => {
    adminMe.mockReturnValue(new Promise(() => {})); // never resolves within this test

    render(
      <AuthGate>
        <p>Dashboard content</p>
      </AuthGate>,
    );

    expect(screen.queryByText('Dashboard content')).not.toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });
});
