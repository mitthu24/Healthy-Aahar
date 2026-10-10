import { scrypt as scryptCallback } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  assertPasswordStrength,
  hashPassword,
  PasswordHashError,
  SCRYPT_N,
  SCRYPT_P,
  SCRYPT_R,
  verifyPassword,
} from './password.js';

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

  it('labels the hash with the exact N/r/p module constants (Fix #7)', async () => {
    const hash = await hashPassword('params-must-match-exactly');
    const [, nStr, rStr, pStr] = hash.split(':');
    expect(Number(nStr)).toBe(SCRYPT_N);
    expect(Number(rStr)).toBe(SCRYPT_R);
    expect(Number(pStr)).toBe(SCRYPT_P);
  });

  it('actually computes with the labelled params, not Node defaults (Fix #7 regression)', async () => {
    // Independently recomputes with the parameters read back out of the
    // label — NOT via verifyPassword, which would trivially pass even if
    // hashPassword and verifyPassword both silently drifted from the label
    // in lockstep. This proves hashPassword's real scrypt() call actually
    // received {N,r,p} explicitly rather than falling back to whatever
    // Node's library defaults happen to be.
    const password = 'independently-recomputed-password';
    const hash = await hashPassword(password);
    const parts = hash.split(':');
    const [, nStr, rStr, pStr, saltHex, hashHex] = parts as [
      string,
      string,
      string,
      string,
      string,
      string,
    ];

    const recomputed = await new Promise<Buffer>((resolve, reject) => {
      scryptCallback(
        password.normalize('NFKC'),
        Buffer.from(saltHex, 'hex'),
        Buffer.from(hashHex, 'hex').length,
        { N: Number(nStr), r: Number(rStr), p: Number(pStr) },
        (err, derived) => (err ? reject(err) : resolve(derived)),
      );
    });

    expect(recomputed.toString('hex')).toBe(hashHex);
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
