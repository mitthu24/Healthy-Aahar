import { DomainError } from '../domain/errors.js';
import type { PasswordHasher } from '../ports/password-hasher.js';
import type { PasswordResetPurpose, PasswordResetRepository } from '../ports/password-reset-repository.js';
import type { SessionRepository } from '../ports/session-repository.js';
import type { SessionTokenHasher } from '../ports/session-token-hasher.js';
import type { UserRepository } from '../ports/user-repository.js';

const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

/**
 * Establishing or resetting a password via a one-time token (PHASE 03,
 * docs/07 §5.1). Audience-agnostic by design: the token identifies the
 * user, so the same consuming endpoint (`setPassword`) serves a newly
 * invited admin setting their first password, an existing admin whose
 * password was reset by a Super Admin, and — once a route calls
 * `issueToken` for one — a customer's self-service "forgot password" flow.
 *
 * `issueToken` is the SINGLE place a raw token is ever minted. It has no
 * opinion on who may call it — that is each caller's job:
 *  - `RbacService.inviteAdmin` / `RbacService.resetAdminPassword` call it
 *    from behind permissioned, audited `/v1/admin/*` routes (Fix #2).
 *  - No customer-facing HTTP route calls it yet. Building one safely needs
 *    a product decision this service cannot make for itself — how the link
 *    is delivered (email provider wiring), and the exact anti-enumeration
 *    shape of the response ("if an account exists, a link was sent" is the
 *    standard pattern, but committing to response wording and the
 *    notification channel is a product call, not a safe inference). This
 *    class is the ready foundation for that route when that decision is
 *    made — see docs/07 §5.1 "Known limitation."
 */
export class PasswordResetService {
  constructor(
    private readonly users: UserRepository,
    private readonly passwordResets: PasswordResetRepository,
    private readonly sessions: SessionRepository,
    private readonly passwordHasher: PasswordHasher,
    private readonly tokenHasher: SessionTokenHasher,
  ) {}

  async issueToken(params: { userId: string; purpose: PasswordResetPurpose; continueUrl?: string }): Promise<string> {
    const rawToken = this.tokenHasher.generate();
    await this.passwordResets.create({
      userId: params.userId,
      tokenHash: this.tokenHasher.hash(rawToken),
      purpose: params.purpose,
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
    });
    // No email/SMS is sent here (out of scope — see class doc above); the
    // caller is responsible for delivering this link through an already
    // authorized channel. Never logged (docs/23 §11).
    return params.continueUrl ? `${params.continueUrl}?token=${rawToken}` : rawToken;
  }

  async setPassword(params: { token: string; newPassword: string }): Promise<void> {
    const weakness = this.passwordHasher.checkStrength(params.newPassword);
    if (weakness) throw new DomainError('WEAK_PASSWORD', weakness);

    const invalidToken = () =>
      new DomainError('PASSWORD_SETUP_TOKEN_INVALID', 'This link is invalid or has expired.');

    const tokenHash = this.tokenHasher.hash(params.token);

    // Atomic claim FIRST (Fix #2 — replaces a separate read-then-write that
    // left a window for two concurrent requests presenting the same token
    // to both believe they'd won). `consume` either exclusively claims an
    // unused, unexpired token in one conditional UPDATE, or returns null —
    // there is no state in which two callers both get a non-null result
    // for the same token. The token is spent the instant this call
    // succeeds, regardless of what the checks below decide next; that is
    // what "single-use" means.
    const claimed = await this.passwordResets.consume(tokenHash);
    if (!claimed) throw invalidToken();

    const user = await this.users.findById(claimed.userId);
    // "Validate account status and user type": `claimed.userId` is a
    // foreign key into `users`, so its `userType` is already exactly one of
    // CUSTOMER/ADMIN by schema — there is no third state to reject. What
    // genuinely needs checking is ACCOUNT STATUS: a token issued while the
    // account was active must not still work after the account was
    // suspended or deactivated in between. Neither branch below reveals
    // anything about which condition failed — a missing or inactive
    // account behind an otherwise-valid token fails exactly like an
    // invalid one.
    if (!user || user.status !== 'ACTIVE') throw invalidToken();

    const passwordHash = await this.passwordHasher.hash(params.newPassword);
    await this.users.setPassword(user.id, passwordHash);

    // A new password invalidates every existing session — a stolen old
    // session must not survive a password change (mirrors the Firebase-era
    // `revokeRefreshTokens` behaviour this replaces).
    await this.sessions.revokeAllForUser(user.id);
  }
}
