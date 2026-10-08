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
 * the admin-invite "set your password" link and a future self-service
 * "forgot password" flow — same table, same repository, `purpose` is
 * metadata only.
 */
export interface PasswordResetRepository {
  create(input: CreatePasswordResetTokenInput): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<PasswordResetTokenRow | null>;
  markUsed(id: string): Promise<void>;
}
