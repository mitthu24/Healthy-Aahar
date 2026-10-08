import { createHash, randomBytes } from 'node:crypto';

/**
 * Opaque session / password-reset tokens (PHASE 03, docs/07 §5).
 *
 * The token itself (256 bits from `randomBytes`) is the security property —
 * it is unguessable. The database never sees it: only `hashToken(raw)` is
 * persisted, so a database leak (backup, replica, SQL injection) cannot be
 * replayed as a valid session. SHA-256 is deliberately NOT scrypt here: the
 * token is already maximally random, so a slow KDF would add request latency
 * (every authenticated request hashes its token) with no corresponding
 * security benefit — scrypt's cost is only useful against LOW-entropy input
 * like human passwords (see `password.ts`).
 */

const TOKEN_BYTES = 32;

export function generateSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

export function hashSessionToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}
