import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DELETE, POST } from './route.js';

/**
 * Regression coverage for the session-persistence fix's first-party cookie
 * endpoint. `next/headers`'s `cookies()` only works inside a real Next.js
 * request scope, so it's mocked here with a minimal in-memory store that
 * mirrors the subset of the real API this route actually calls (`get`,
 * `set`, `delete`).
 */

const store = new Map<string, { value: string }>();

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => store.get(name),
    set: (name: string, value: string) => {
      store.set(name, { value });
    },
    delete: (name: string) => {
      store.delete(name);
    },
  }),
}));

function sameOriginRequest(method: string, body?: unknown) {
  return new NextRequest('https://healthy-aahar-customer.vercel.app/api/session', {
    method,
    headers: {
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => {
  store.clear();
});

describe('POST /api/session', () => {
  it('persists a non-empty token into the cookie store', async () => {
    const res = await POST(sameOriginRequest('POST', { token: 'tok-123' }));

    expect(res.status).toBe(200);
    expect(store.get('ha_customer_session')?.value).toBe('tok-123');
  });

  it('rejects a missing token with 422, writing nothing', async () => {
    const res = await POST(sameOriginRequest('POST', {}));

    expect(res.status).toBe(422);
    expect(store.has('ha_customer_session')).toBe(false);
  });

  it('rejects an empty-string token with 422', async () => {
    const res = await POST(sameOriginRequest('POST', { token: '' }));
    expect(res.status).toBe(422);
  });

  it('rejects a cross-site request (Sec-Fetch-Site != same-origin) with 403, writing nothing', async () => {
    const req = new NextRequest('https://healthy-aahar-customer.vercel.app/api/session', {
      method: 'POST',
      headers: { 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'stolen-attempt' }),
    });

    const res = await POST(req);

    expect(res.status).toBe(403);
    expect(store.has('ha_customer_session')).toBe(false);
  });

  it('fails closed when Sec-Fetch-Site is absent (e.g. a non-browser client)', async () => {
    const req = new NextRequest('https://healthy-aahar-customer.vercel.app/api/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'tok-123' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/session', () => {
  it('clears a previously set cookie', async () => {
    store.set('ha_customer_session', { value: 'tok-123' });

    const res = await DELETE(sameOriginRequest('DELETE'));

    expect(res.status).toBe(200);
    expect(store.has('ha_customer_session')).toBe(false);
  });

  it('is a no-op (still 200) when nothing was set — logout called twice', async () => {
    const res = await DELETE(sameOriginRequest('DELETE'));
    expect(res.status).toBe(200);
  });

  it('rejects a cross-site request with 403, leaving an existing cookie untouched', async () => {
    store.set('ha_customer_session', { value: 'tok-123' });
    const req = new NextRequest('https://healthy-aahar-customer.vercel.app/api/session', {
      method: 'DELETE',
      headers: { 'sec-fetch-site': 'cross-site' },
    });

    const res = await DELETE(req);

    expect(res.status).toBe(403);
    expect(store.get('ha_customer_session')?.value).toBe('tok-123');
  });
});
