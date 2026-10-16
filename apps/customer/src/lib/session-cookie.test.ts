import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Direct coverage of the cookie read/write/clear helpers, independent of
 * the route handler that calls them (see `app/api/session/route.test.ts`
 * for the HTTP-level behavior, including the same-origin guard).
 */

type SetArgs = [name: string, value: string, options?: Record<string, unknown>];

const store = new Map<string, string>();
let lastSetArgs: SetArgs | undefined;

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (store.has(name) ? { value: store.get(name) } : undefined),
    set: (...args: SetArgs) => {
      lastSetArgs = args;
      store.set(args[0], args[1]);
    },
    delete: (name: string) => {
      store.delete(name);
    },
  }),
}));

beforeEach(() => {
  store.clear();
  lastSetArgs = undefined;
});

describe('session-cookie', () => {
  it('readSessionCookie returns null when nothing has been set', async () => {
    const { readSessionCookie } = await import('./session-cookie.js');
    expect(await readSessionCookie()).toBeNull();
  });

  it('writeSessionCookie then readSessionCookie round-trips the token', async () => {
    const { readSessionCookie, writeSessionCookie } = await import('./session-cookie.js');

    await writeSessionCookie('tok-xyz');

    expect(await readSessionCookie()).toBe('tok-xyz');
  });

  it('writeSessionCookie sets HttpOnly, SameSite=Lax, Path=/ — never readable by page script, never sent cross-site', async () => {
    const { writeSessionCookie } = await import('./session-cookie.js');

    await writeSessionCookie('tok-xyz');

    const options = lastSetArgs?.[2] as Record<string, unknown> | undefined;
    expect(options?.httpOnly).toBe(true);
    expect(options?.sameSite).toBe('lax');
    expect(options?.path).toBe('/');
  });

  it('clearSessionCookie removes a previously set token', async () => {
    const { clearSessionCookie, readSessionCookie, writeSessionCookie } =
      await import('./session-cookie.js');

    await writeSessionCookie('tok-xyz');
    await clearSessionCookie();

    expect(await readSessionCookie()).toBeNull();
  });
});
