import { describe, expect, it } from 'vitest';

import { assertPasswordStrength, hashPassword, PasswordHashError, verifyPassword } from './password.js';

describe('hashPassword / verifyPassword (PHASE 03, docs/07)', () => {
  it('verifies a correct password against its own hash', async () => {
    const hash = await hashPassword('correct horse battery staple');
    await expect(verifyPassword('correct horse battery staple', hash)).resolves.toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    await expect(verifyPassword('wrong password entirely', hash)).resolves.toBe(false);
  });

  it('produces a different hash (different salt) for the same password each time', async () => {
    const a = await hashPassword('same-password-both-times');
    const b = await hashPassword('same-password-both-times');
    expect(a).not.toBe(b);
    // Both still verify correctly despite differing — the salt is embedded.
    await expect(verifyPassword('same-password-both-times', a)).resolves.toBe(true);
    await expect(verifyPassword('same-password-both-times', b)).resolves.toBe(true);
  });

  it('never stores or accepts plaintext — the stored format is always "scrypt:..."', async () => {
    const hash = await hashPassword('whatever');
    expect(hash.startsWith('scrypt:')).toBe(true);
    expect(hash).not.toContain('whatever');
  });

  it('rejects verification against a malformed hash instead of throwing', async () => {
    await expect(verifyPassword('anything', 'not-a-real-hash')).resolves.toBe(false);
    await expect(verifyPassword('anything', '')).resolves.toBe(false);
    await expect(verifyPassword('anything', 'md5:deadbeef')).resolves.toBe(false);
    await expect(verifyPassword('anything', 'scrypt:not:numbers:here:zz:zz')).resolves.toBe(false);
  });

  it('rejects a hash with a tampered derived key', async () => {
    const hash = await hashPassword('tamper-test');
    const tampered = hash.slice(0, -4) + '0000';
    await expect(verifyPassword('tamper-test', tampered)).resolves.toBe(false);
  });
});

describe('assertPasswordStrength (NIST 800-63B — length, not composition rules)', () => {
  it('accepts a password at the minimum length', () => {
    expect(() => assertPasswordStrength('1234567890')).not.toThrow();
  });

  it('rejects a password shorter than the minimum', () => {
    expect(() => assertPasswordStrength('short1')).toThrow(PasswordHashError);
  });

  it('rejects a password longer than the maximum (CPU-exhaustion guard)', () => {
    expect(() => assertPasswordStrength('a'.repeat(257))).toThrow(PasswordHashError);
  });

  it('does not require mixed case, digits or symbols', () => {
    expect(() => assertPasswordStrength('aaaaaaaaaaaaaaaa')).not.toThrow();
  });
});
