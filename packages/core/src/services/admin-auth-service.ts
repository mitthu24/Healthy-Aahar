import type { BusinessScope } from '../domain/business-scope.js';
import { DomainError } from '../domain/errors.js';
import type { AdminRepository, AdminUserRow } from '../ports/admin-repository.js';
import type { PasswordHasher } from '../ports/password-hasher.js';
import type { SessionRepository } from '../ports/session-repository.js';
import type { SessionTokenHasher } from '../ports/session-token-hasher.js';
import type { UserRepository } from '../ports/user-repository.js';
import { validateSession } from './session-validation.js';

export type AdminActor = {
  kind: 'ADMIN';
  userId: string;
  adminUserId: string;
  permissions: ReadonlySet<string>;
  isSuperAdmin: boolean;
};

export type AdminLoginParams = {
  email: string;
  password: string;
  sessionTtlMs: number;
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
};

export type AdminLoginResult = { token: string; actor: AdminActor };

/**
 * Admin email/password authentication and DB-backed sessions (PHASE 03,
 * docs/07 §5, §6 — supersedes the Firebase session-cookie design).
 *
 * Every admin-authenticated request re-checks `users.status` — a session
 * stays valid for up to `ADMIN_SESSION_MAX_AGE_SECONDS`, but suspending an
 * account in our own database must take effect on the very next request
 * (BR-SEC3), not up to 12 hours later.
 */
export class AdminAuthService {
  constructor(
    private readonly admins: AdminRepository,
    private readonly users: UserRepository,
    private readonly sessions: SessionRepository,
    private readonly passwordHasher: PasswordHasher,
    private readonly tokenHasher: SessionTokenHasher,
  ) {}

  /**
   * Login failure is ALWAYS the same generic error — unknown email, no
   * password set yet (invited but never completed setup), wrong password,
   * and a suspended account are indistinguishable to the caller. This is
   * what prevents account enumeration (Step 5).
   */
  async login(scope: BusinessScope, params: AdminLoginParams): Promise<AdminLoginResult> {
    const genericFailure = () => new DomainError('INVALID_CREDENTIALS', 'Incorrect email or password.');

    const user = await this.users.findByEmail(params.email, 'ADMIN');
    if (!user || !user.passwordHash) {
      // Burn roughly the same CPU time a real verify() would take, so the
      // response-time gap between "no such account" and "wrong password"
      // cannot be used to enumerate which emails have accounts.
      await this.passwordHasher.hash(params.password);
      throw genericFailure();
    }

    const valid = await this.passwordHasher.verify(params.password, user.passwordHash);
    if (!valid) throw genericFailure();
    if (user.status !== 'ACTIVE') throw genericFailure();

    const found = await this.admins.findByUserId(scope, user.id);
    if (!found || found.admin.deletedAt) throw genericFailure();

    const effective = await this.admins.loadEffectivePermissions(scope, found.admin.id);

    const token = await this.issueSession(user.id, params.sessionTtlMs, params.ipAddress, params.userAgent);
    await this.users.touchLastLogin(user.id);

    return {
      token,
      actor: {
        kind: 'ADMIN',
        userId: user.id,
        adminUserId: found.admin.id,
        permissions: new Set(effective.permissions),
        isSuperAdmin: effective.isSuperAdmin,
      },
    };
  }

  /** Called by the admin-auth middleware after `validateSession` succeeds. */
  async verifySession(rawToken: string, idleTimeoutMs: number): Promise<{ userId: string }> {
    const { userId } = await validateSession(this.sessions, this.tokenHasher, rawToken, { idleTimeoutMs });
    return { userId };
  }

  async resolveActor(scope: BusinessScope, userId: string): Promise<AdminActor> {
    const user = await this.users.findById(userId);
    if (!user || user.status !== 'ACTIVE') {
      throw new DomainError('ACCOUNT_SUSPENDED', 'This admin account is suspended or deactivated.');
    }
    // Fix #4, symmetric case: a customer's session token presented as the
    // admin cookie resolves to SOME `users` row (the customer's), which is
    // ACTIVE — so without this check it would proceed to the admin_users
    // lookup below. That lookup already fails closed today (a customer
    // never has an `admin_users` row), but this makes the audience check
    // explicit rather than an accident of a different table's absence, and
    // keeps both directions of this boundary checked the same way.
    if (user.userType !== 'ADMIN') {
      throw new DomainError('UNAUTHENTICATED', 'No admin account exists for this identity.');
    }

    const found = await this.admins.findByUserId(scope, userId);
    if (!found || found.admin.deletedAt) {
      throw new DomainError('UNAUTHENTICATED', 'No admin account exists for this identity.');
    }

    const effective = await this.admins.loadEffectivePermissions(scope, found.admin.id);

    return {
      kind: 'ADMIN',
      userId: user.id,
      adminUserId: found.admin.id,
      permissions: new Set(effective.permissions),
      isSuperAdmin: effective.isSuperAdmin,
    };
  }

  /** For GET /v1/admin/auth/me and the login response — display data, not authorization. */
  async getProfile(scope: BusinessScope, adminUserId: string): Promise<AdminUserRow | null> {
    return this.admins.findById(scope, adminUserId);
  }

  /**
   * Self-service change of one's OWN password while already signed in
   * (Phase 04) — distinct from `RbacService.resetAdminPassword`, which
   * issues a token for someone else to redeem. Requires the current
   * password rather than trusting the session alone, and revokes every
   * other session the same way a token-based reset already does.
   */
  async changeOwnPassword(
    scope: BusinessScope,
    params: { userId: string; adminUserId: string; currentPassword: string; newPassword: string },
  ): Promise<void> {
    const invalidCurrent = () => new DomainError('INVALID_CREDENTIALS', 'Current password is incorrect.');

    const user = await this.users.findById(params.userId);
    if (!user || !user.passwordHash) throw invalidCurrent();

    const valid = await this.passwordHasher.verify(params.currentPassword, user.passwordHash);
    if (!valid) throw invalidCurrent();

    const weakness = this.passwordHasher.checkStrength(params.newPassword);
    if (weakness) throw new DomainError('WEAK_PASSWORD', weakness);

    const newHash = await this.passwordHasher.hash(params.newPassword);
    await this.users.setPassword(params.userId, newHash);
    await this.admins.markPasswordChanged(scope, params.adminUserId);
    await this.sessions.revokeAllForUser(params.userId);
  }

  async logout(rawToken: string): Promise<void> {
    const tokenHash = this.tokenHasher.hash(rawToken);
    const session = await this.sessions.findByTokenHash(tokenHash);
    if (session) await this.sessions.revoke(session.id);
  }

  private async issueSession(
    userId: string,
    ttlMs: number,
    ipAddress?: string | undefined,
    userAgent?: string | undefined,
  ): Promise<string> {
    const token = this.tokenHasher.generate();
    await this.sessions.create({
      userId,
      tokenHash: this.tokenHasher.hash(token),
      expiresAt: new Date(Date.now() + ttlMs),
      ipAddress,
      userAgent,
    });
    return token;
  }
}
