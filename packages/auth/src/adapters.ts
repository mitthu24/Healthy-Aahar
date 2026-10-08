import type { PasswordHasher, SessionTokenHasher } from '@healthy-aahar/core';

import { assertPasswordStrength, hashPassword, PasswordHashError, verifyPassword } from './password.js';
import { generateSessionToken, hashSessionToken } from './session-token.js';

/**
 * Ready-made implementations of `core`'s auth ports, wired in at the
 * composition root (`apps/api/src/app.ts`). `core` never imports this file —
 * only the port types — keeping the dependency direction the same as every
 * other port/adapter pair in this codebase.
 */
export const scryptPasswordHasher: PasswordHasher = {
  hash: hashPassword,
  verify: verifyPassword,
  checkStrength(password: string): string | undefined {
    try {
      assertPasswordStrength(password);
      return undefined;
    } catch (error) {
      if (error instanceof PasswordHashError) return error.message;
      throw error;
    }
  },
};

export const sha256SessionTokenHasher: SessionTokenHasher = {
  generate: generateSessionToken,
  hash: hashSessionToken,
};
