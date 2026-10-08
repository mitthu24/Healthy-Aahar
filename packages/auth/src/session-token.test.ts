import { describe, expect, it } from 'vitest';

import { generateSessionToken, hashSessionToken } from './session-token.js';

describe('generateSessionToken / hashSessionToken (PHASE 03, docs/07 §5)', () => {
  it('generates a unique token on every call', () => {
    const tokens = new Set(Array.from({ length: 1000 }, () => generateSessionToken()));
    expect(tokens.size).toBe(1000);
  });

  it('hashes deterministically — the same token always hashes the same way', () => {
    const token = generateSessionToken();
    expect(hashSessionToken(token)).toBe(hashSessionToken(token));
  });

  it('produces different hashes for different tokens', () => {
    const a = generateSessionToken();
    const b = generateSessionToken();
    expect(hashSessionToken(a)).not.toBe(hashSessionToken(b));
  });

  it('the hash never contains the raw token as a substring', () => {
    const token = generateSessionToken();
    expect(hashSessionToken(token)).not.toContain(token);
  });
});
