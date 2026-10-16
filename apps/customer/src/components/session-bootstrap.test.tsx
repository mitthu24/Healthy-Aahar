import { render, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getSessionToken, setSessionToken } from '@/lib/session-store';

import { SessionBootstrap } from './session-bootstrap.js';

/**
 * Regression coverage for the session-persistence fix: a hard reload used
 * to always lose the session (`session-store`'s in-memory token resets to
 * `null` on every page load). `SessionBootstrap` restores it from the
 * HttpOnly cookie the server read (`initialToken`, passed down from
 * `app/layout.tsx`) and re-validates it, mirroring the admin app's
 * `AuthGate` — the only prior precedent for this "confirm the session is
 * still really valid" pattern in this monorepo.
 */

const customerMe = vi.fn();
const clearPersistedSessionToken = vi.fn();

vi.mock('@/lib/api-client', () => ({
  apiClient: { customerMe: () => customerMe() },
}));

vi.mock('@/lib/session-client', () => ({
  clearPersistedSessionToken: () => clearPersistedSessionToken(),
}));

beforeEach(() => {
  customerMe.mockReset();
  clearPersistedSessionToken.mockReset();
  setSessionToken(null);
});

afterEach(() => {
  setSessionToken(null);
});

describe('SessionBootstrap', () => {
  it('login followed by a hard reload: a valid restored token populates the in-memory store immediately', () => {
    customerMe.mockReturnValue(new Promise(() => {})); // never resolves within this test

    render(<SessionBootstrap initialToken="tok-restored" />);

    // Set synchronously in the effect body, before the /auth/me check
    // resolves — the UI must not flash "signed out" while that check is
    // still in flight.
    expect(getSessionToken()).toBe('tok-restored');
  });

  it('registration followed by a hard reload: same restore path, independent of how the token was first obtained', () => {
    // SessionBootstrap has no knowledge of login vs. register — both write
    // the same cookie via `persistSessionToken` — so this is the identical
    // scenario under a different name, confirming there's no login-only
    // special case that register would miss.
    customerMe.mockResolvedValue({ user_id: 'u1', customer_profile_id: 'p1' });

    render(<SessionBootstrap initialToken="tok-from-register" />);

    expect(getSessionToken()).toBe('tok-from-register');
  });

  it('a confirmed-valid session is left alone — no clear is triggered', async () => {
    customerMe.mockResolvedValue({ user_id: 'u1', customer_profile_id: 'p1' });

    render(<SessionBootstrap initialToken="tok-valid" />);

    await waitFor(() => expect(customerMe).toHaveBeenCalledTimes(1));
    expect(clearPersistedSessionToken).not.toHaveBeenCalled();
    expect(getSessionToken()).toBe('tok-valid');
  });

  it('expired or invalid session: a restored token that /auth/me rejects is cleared, not left stuck signed-in', async () => {
    customerMe.mockRejectedValue(new Error('SESSION_EXPIRED'));

    render(<SessionBootstrap initialToken="tok-stale" />);

    await waitFor(() => expect(clearPersistedSessionToken).toHaveBeenCalledTimes(1));
  });

  it('no cookie present (fresh/incognito load, never logged in): does nothing, makes no API call', () => {
    render(<SessionBootstrap initialToken={null} />);

    expect(customerMe).not.toHaveBeenCalled();
    expect(getSessionToken()).toBeNull();
  });

  it('runs the restore-and-verify sequence only once under StrictMode (which double-invokes effects in dev)', async () => {
    customerMe.mockResolvedValue({ user_id: 'u1', customer_profile_id: 'p1' });

    render(
      <StrictMode>
        <SessionBootstrap initialToken="tok-valid" />
      </StrictMode>,
    );

    await waitFor(() => expect(customerMe).toHaveBeenCalled());
    // Give any second (erroneous) invocation a chance to also fire before asserting.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(customerMe).toHaveBeenCalledTimes(1);
  });
});
