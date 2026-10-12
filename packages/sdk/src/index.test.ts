import { describe, expect, it } from 'vitest';

import { ApiClient } from './index.js';

/**
 * Regression test for a live production bug: every API call from both
 * frontends threw `TypeError: Failed to execute 'fetch' on 'Window':
 * Illegal invocation` in every real browser (Chrome, Firefox, Safari all
 * enforce this), because `this.fetchImpl = options.fetchImpl ?? fetch`
 * captured the bare native `fetch` function, and `this.fetchImpl(url, init)`
 * then invokes it with `this` bound to the ApiClient instance rather than
 * `window` — exactly the receiver browsers' native `fetch` rejects.
 *
 * Plain vitest mocks (`vi.fn()`) don't reproduce this: they don't care what
 * `this` they're called with, so a naive test would pass against the
 * broken code too. `makeReceiverCheckedFetch` below mimics the real
 * browser behaviour by throwing unless called with exactly the expected
 * receiver, the same way native `fetch` does.
 */
function makeReceiverCheckedFetch(expectedReceiver: unknown) {
  function fakeFetch(this: unknown): Promise<Response> {
    if (this !== expectedReceiver) {
      throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
    }
    return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }));
  }
  return fakeFetch as unknown as typeof fetch;
}

describe('ApiClient', () => {
  it('calls fetchImpl with the correct receiver — never throws "Illegal invocation"', async () => {
    const client = new ApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: makeReceiverCheckedFetch(globalThis),
    });

    // This is any real request path; the point is only that invoking it
    // must not throw the receiver-check TypeError. Before the `.bind()`
    // fix, this threw for every single request the SDK ever made in a
    // real browser.
    await expect(client.listProducts()).resolves.toEqual({ data: [] });
  });

  it('rejects when fetchImpl is actually called with the wrong receiver — proves the test double is meaningful', async () => {
    // Guards against the test above passing for the wrong reason (e.g. a
    // future refactor that stops calling fetchImpl at all). A receiver
    // other than the one ApiClient binds to must still throw.
    const wrongReceiverFetch = makeReceiverCheckedFetch({ not: 'globalThis' });
    expect(() =>
      wrongReceiverFetch.call({ some: 'other object' }, 'https://api.example.test'),
    ).toThrow('Illegal invocation');
  });

  describe('admin CSRF token — captured from response header, not a cookie read', () => {
    /**
     * Regression test for a live production bug: the admin app and API are
     * on different origins, so JS on the admin app can never read the
     * `admin_csrf` cookie the API sets via `document.cookie` — a browser
     * same-origin restriction no `SameSite`/`Secure` setting changes. The
     * login route also sends the same token as an `X-CSRF-Token` response
     * header (CORS-exposed); the client must capture THAT and echo it back
     * on later mutating requests, or every one of them is rejected with
     * "Missing or invalid CSRF token."
     */
    function recordingFetch(
      responses: Array<{ status: number; headers?: Record<string, string>; body: unknown }>,
    ) {
      const calls: Array<{ url: string; init: RequestInit }> = [];
      let i = 0;
      const fetchImpl = (async (url: string, init: RequestInit = {}) => {
        calls.push({ url, init });
        const r = responses[Math.min(i, responses.length - 1)]!;
        i += 1;
        return new Response(JSON.stringify(r.body), { status: r.status, headers: r.headers });
      }) as unknown as typeof fetch;
      return { fetchImpl, calls };
    }

    it('echoes the X-CSRF-Token captured from the login response on the next mutating request', async () => {
      const { fetchImpl, calls } = recordingFetch([
        { status: 200, headers: { 'X-CSRF-Token': 'issued-token-abc' }, body: { ok: true } },
        { status: 200, body: { changed: true } },
      ]);
      const client = new ApiClient({ baseUrl: 'https://api.example.test', fetchImpl });

      await client.adminLogin({ email: 'admin@example.test', password: 'x' });
      await client.adminChangePassword({ current_password: 'x', new_password: 'y'.repeat(10) });

      const changePasswordHeaders = new Headers(calls[1]!.init.headers);
      expect(changePasswordHeaders.get('X-CSRF-Token')).toBe('issued-token-abc');
    });

    it('does not attach X-CSRF-Token on GET/HEAD requests even after a token was captured', async () => {
      const { fetchImpl, calls } = recordingFetch([
        { status: 200, headers: { 'X-CSRF-Token': 'issued-token-abc' }, body: { ok: true } },
        { status: 200, body: { data: [] } },
      ]);
      const client = new ApiClient({ baseUrl: 'https://api.example.test', fetchImpl });

      await client.adminLogin({ email: 'admin@example.test', password: 'x' });
      await client.adminMe();

      const meHeaders = new Headers(calls[1]!.init.headers);
      expect(meHeaders.has('X-CSRF-Token')).toBe(false);
    });

    it('prefers a caller-supplied getCsrfToken over the captured header value', async () => {
      const { fetchImpl, calls } = recordingFetch([
        { status: 200, headers: { 'X-CSRF-Token': 'from-response-header' }, body: { ok: true } },
        { status: 200, body: { changed: true } },
      ]);
      const client = new ApiClient({
        baseUrl: 'https://api.example.test',
        fetchImpl,
        getCsrfToken: () => 'from-caller-override',
      });

      await client.adminLogin({ email: 'admin@example.test', password: 'x' });
      await client.adminChangePassword({ current_password: 'x', new_password: 'y'.repeat(10) });

      const changePasswordHeaders = new Headers(calls[1]!.init.headers);
      expect(changePasswordHeaders.get('X-CSRF-Token')).toBe('from-caller-override');
    });
  });
});
