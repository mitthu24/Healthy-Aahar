/**
 * The slice of password hashing that services depend on. Declared here so
 * `core` never imports `@healthy-aahar/auth`'s concrete scrypt
 * implementation directly — `apps/api` wires the real adapter in; tests can
 * supply a fast fake (e.g. plaintext-equality) without pulling scrypt's real
 * CPU cost into every unit test.
 */
export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, storedHash: string): Promise<boolean>;
  /** Returns a reason string when the password fails the minimum policy, otherwise `undefined`. */
  checkStrength(password: string): string | undefined;
}
