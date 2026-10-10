import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';

/**
 * Password hashing (PHASE 03, docs/07).
 *
 * scrypt, not bcrypt/argon2: no extra dependency (Node's `crypto` module),
 * memory-hard by construction, and tunable via the same three parameters
 * OWASP recommends (N, r, p). MD5, SHA-1 and plain SHA-256 are deliberately
 * not used — none of them are memory-hard, so a password database leak is
 * crackable at GPU/ASIC speed; scrypt is designed specifically to make that
 * expensive.
 *
 * Stored format: `scrypt:N:r:p:<saltHex>:<hashHex>` — the parameters travel
 * with the hash so they can be tuned upward later without invalidating
 * every existing credential (a future login re-hashes transparently; not
 * implemented yet because PHASE 03 ships with one parameter set only).
 */

// Exported so tests can assert the stored hash's label actually matches what
// was used to compute it (Fix #7) without hardcoding the values twice.
export const SCRYPT_N = 16384; // CPU/memory cost (2^14) — OWASP's current minimum for interactive logins.
export const SCRYPT_R = 8;
export const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const SALT_BYTES = 16;

export class PasswordHashError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PasswordHashError';
  }
}

/**
 * Both `hashPassword` and `verifyPassword` route through this single
 * function with EXPLICIT `{N, r, p}` — never Node's library defaults.
 *
 * `hashPassword` used to call the promisified `scrypt()` with no options,
 * relying on Node's defaults (16384/8/1) happening to equal the
 * `SCRYPT_N`/`R`/`P` constants below. That was a latent trap: the stored
 * hash's label comes from these constants, but the actual computation came
 * from Node's own defaults — tuning the constants upward (which the format
 * is explicitly designed to support) would silently keep hashing at the
 * OLD cost while labelling new hashes with the NEW one, so every
 * subsequent login would fail to verify until someone noticed. Passing the
 * constants explicitly here makes the label and the computation the same
 * value by construction, not by coincidence.
 */
function scryptWithParams(
  password: string,
  salt: Buffer,
  keylen: number,
  N: number,
  r: number,
  p: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, { N, r, p }, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scryptWithParams(
    password.normalize('NFKC'),
    salt,
    KEY_LENGTH,
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
  );
  return `scrypt:${SCRYPT_N}:${SCRYPT_R}:${SCRYPT_P}:${salt.toString('hex')}:${derived.toString('hex')}`;
}

/**
 * Verifies a password against a stored hash. Constant-time at the final
 * comparison (`timingSafeEqual`) so a byte-by-byte early-exit compare cannot
 * leak how much of the hash matched.
 *
 * Returns `false` for a malformed/unrecognised hash rather than throwing —
 * callers (the login service) must be able to treat "bad hash in the
 * database" identically to "wrong password": both are a failed login, never
 * a 500, and never a hint to the caller about which one occurred.
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split(':');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, nStr, rStr, pStr, saltHex, hashHex] = parts as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  const n = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltHex, 'hex');
    expected = Buffer.from(hashHex, 'hex');
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  let derived: Buffer;
  try {
    derived = await scryptWithParams(password.normalize('NFKC'), salt, expected.length, n, r, p);
  } catch {
    // A corrupt hash (e.g. parameters too large for the configured memory
    // limit) must fail the login, not crash the request.
    return false;
  }

  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

/**
 * Minimum password policy (Step 13 — "password hashing", not strength
 * theatre). Length is the dominant factor in resisting offline guessing;
 * composition rules are deliberately NOT enforced (NIST 800-63B) because
 * they push users toward predictable substitutions without adding entropy.
 */
export function assertPasswordStrength(password: string): void {
  if (password.length < 10) {
    throw new PasswordHashError('Password must be at least 10 characters.');
  }
  if (password.length > 256) {
    // scrypt has no practical upper bound, but an attacker-supplied
    // multi-megabyte "password" is a cheap CPU-exhaustion vector.
    throw new PasswordHashError('Password must be at most 256 characters.');
  }
}
