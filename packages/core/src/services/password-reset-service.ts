import { DomainError } from '../domain/errors.js';
import type { PasswordHasher } from '../ports/password-hasher.js';
import type { PasswordResetRepository } from '../ports/password-reset-repository.js';
import type { SessionRepository } from '../ports/session-repository.js';
import type { SessionTokenHasher } from '../ports/session-token-hasher.js';
import type { UserRepository } from '../ports/user-repository.js';

/**
 * Establishing or resetting a password via a one-time token (PHASE 03,
 * docs/07 §5.1). Audience-agnostic by design: the token identifies the user,
 * so the same endpoint serves a newly invited admin setting their first
 * password and a customer's future self-service "forgot password" flow.
 */
export class PasswordResetService {
  constructor(
    private readonly users: UserRepository,
    private readonly passwordResets: PasswordResetRepository,
    private readonly sessions: SessionRepository,
    private readonly passwordHasher: PasswordHasher,
    private readonly tokenHasher: SessionTokenHasher,
  ) {}

  async setPassword(params: { token: string; newPassword: string }): Promise<void> {
    const weakness = this.passwordHasher.checkStrength(params.newPassword);
    if (weakness) throw new DomainError('WEAK_PASSWORD', weakness);

    const invalidToken = () =>
      new DomainError('PASSWORD_SETUP_TOKEN_INVALID', 'This link is invalid or has expired.');

    const tokenHash = this.tokenHasher.hash(params.token);
    const record = await this.passwordResets.findByTokenHash(tokenHash);
    if (!record) throw invalidToken();
    if (record.usedAt) throw invalidToken();
    if (record.expiresAt.getTime() <= Date.now()) throw invalidToken();

    const passwordHash = await this.passwordHasher.hash(params.newPassword);
    await this.users.setPassword(record.userId, passwordHash);
    await this.passwordResets.markUsed(record.id);

    // A new password invalidates every existing session — a stolen old
    // session must not survive a password change (mirrors the Firebase-era
    // `revokeRefreshTokens` behaviour this replaces).
    await this.sessions.revokeAllForUser(record.userId);
  }
}
