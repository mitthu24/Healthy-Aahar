export type PasswordResetPurpose = 'SETUP' | 'RESET';

export type PasswordResetTokenRow = {
  id: string;
  userId: string;
  purpose: PasswordResetPurpose;
  expiresAt: Date;
  usedAt: Date | null;
};

export type CreatePasswordResetTokenInput = {
  userId: string;
  tokenHash: string;
  purpose: PasswordResetPurpose;
  expiresAt: Date;
};

/**
 * One-time password setup/reset tokens (PHASE 03, docs/07 §5.1). Backs both
 * the admin-invite "set your password" link, the authorized admin
 * password-reset action, and a future self-service customer "forgot
 * password" flow — same table, same repository, `purpose` is metadata only.
 */
export interface PasswordResetRepository {
  create(input: CreatePasswordResetTokenInput): Promise<void>;

  /**
   * Atomically claims a token if (and only if) it is unused and unexpired,
   * in one conditional UPDATE — never a separate read-then-write. Two
   * concurrent requests presenting the SAME token race on this single
   * statement at the database's row-lock level: exactly one can match
   * `used_at IS NULL`, so exactly one gets the row back and the other gets
   * `null`, with no window in which both could believe they won (Fix #2 —
   * the previous `findByTokenHash` + separate `markUsed` pair had exactly
   * that window).
   */
  consume(tokenHash: string): Promise<PasswordResetTokenRow | null>;
}
