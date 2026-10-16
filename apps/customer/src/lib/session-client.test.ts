import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearPersistedSessionToken, persistSessionToken } from './session-client.js';
import { getSessionToken, setSessionToken } from './session-store.js';

describe('session-client', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    setSessionToken(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setSessionToken(null);
  });

  describe('persistSessionToken', () => {
    it('updates the in-memory store synchronously', () => {
      persistSessionToken('tok-abc');
      expect(getSessionToken()).toBe('tok-abc');
    });

    it('POSTs the token to the first-party session endpoint', () => {
      persistSessionToken('tok-abc');

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/session',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: 'tok-abc' }),
        }),
      );
    });

    it('still leaves the in-memory token set even if persisting the cookie fails', async () => {
      fetchMock.mockRejectedValue(new TypeError('network error'));

      persistSessionToken('tok-abc');
      expect(getSessionToken()).toBe('tok-abc');

      // Let the rejected fire-and-forget promise's .catch() settle so it
      // doesn't surface as an unhandled rejection in this test.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });

  describe('clearPersistedSessionToken', () => {
    it('clears the in-memory store synchronously', () => {
      setSessionToken('tok-abc');

      clearPersistedSessionToken();

      expect(getSessionToken()).toBeNull();
    });

    it('DELETEs the first-party session endpoint', () => {
      clearPersistedSessionToken();

      expect(fetchMock).toHaveBeenCalledWith('/api/session', { method: 'DELETE' });
    });
  });
});
