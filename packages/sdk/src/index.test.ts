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
});
