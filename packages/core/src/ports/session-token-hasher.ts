/**
 * Opaque-token generation/hashing for both sessions and password-reset
 * links. See `@healthy-aahar/auth`'s `session-token.ts` for why this is a
 * fast hash (SHA-256) rather than a slow KDF — the token's entropy, not the
 * hash's cost, is the security property here.
 */
export interface SessionTokenHasher {
  generate(): string;
  hash(rawToken: string): string;
}
