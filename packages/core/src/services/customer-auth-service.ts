import type { BusinessScope } from '../domain/business-scope.js';
import { DomainError } from '../domain/errors.js';
import type { PasswordHasher } from '../ports/password-hasher.js';
import type { SessionRepository } from '../ports/session-repository.js';
import type { SessionTokenHasher } from '../ports/session-token-hasher.js';
import type { CustomerProfileRow, UserRepository, UserRow } from '../ports/user-repository.js';
import { validateSession } from './session-validation.js';

export type CustomerActor = {
  kind: 'CUSTOMER';
  userId: string;
  customerProfileId: string;
};

export type CustomerAuthResult = {
  user: UserRow;
  profile: CustomerProfileRow;
  token: string;
};

export type RegisterParams = {
  email: string;
  password: string;
  phone?: string | undefined;
  firstName?: string | undefined;
  lastName?: string | undefined;
  sessionTtlMs: number;
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
};

export type LoginParams = {
  email: string;
  password: string;
  sessionTtlMs: number;
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
};

/**
 * Customer email/password authentication and DB-backed sessions (PHASE 03,
 * docs/07 §4 — supersedes the Firebase phone-OTP bearer-token design).
 *
 * The customer API stays bearer-token / cookie-free by design (docs/30 §2 —
 * mobile-readiness): `login`/`register` return the raw session token in the
 * response body, never set a cookie, and every other customer route
 * resolves the SAME `Authorization: Bearer <token>` header a future
 * React Native/Expo client would send with zero changes to this service.
 */
export class CustomerAuthService {
  constructor(
    private readonly users: UserRepository,
    private readonly sessions: SessionRepository,
    private readonly passwordHasher: PasswordHasher,
    private readonly tokenHasher: SessionTokenHasher,
  ) {}

  async register(scope: BusinessScope, params: RegisterParams): Promise<CustomerAuthResult> {
    const weakness = this.passwordHasher.checkStrength(params.password);
    if (weakness) throw new DomainError('WEAK_PASSWORD', weakness);

    const passwordHash = await this.passwordHasher.hash(params.password);

    const result = await this.users.createCustomerWithPassword(scope, {
      email: params.email,
      passwordHash,
      phone: params.phone,
      firstName: params.firstName,
      lastName: params.lastName,
    });

    if (!result.ok) {
      throw new DomainError('EMAIL_ALREADY_REGISTERED', 'An account with this email already exists.');
    }

    const token = await this.issueSession(result.user.id, params.sessionTtlMs, params.ipAddress, params.userAgent);
    await this.users.touchLastLogin(result.user.id);

    return { user: result.user, profile: result.profile, token };
  }

  async login(params: LoginParams): Promise<CustomerAuthResult> {
    const genericFailure = () => new DomainError('INVALID_CREDENTIALS', 'Incorrect email or password.');

    const user = await this.users.findByEmail(params.email, 'CUSTOMER');
    if (!user || !user.passwordHash) {
      // Same timing-attack mitigation as AdminAuthService.login.
      await this.passwordHasher.hash(params.password);
      throw genericFailure();
    }

    const valid = await this.passwordHasher.verify(params.password, user.passwordHash);
    if (!valid) throw genericFailure();
    if (user.status !== 'ACTIVE') throw genericFailure();

    const profile = await this.users.findCustomerProfile(user.id);
    if (!profile) {
      throw new DomainError('INTERNAL_ERROR', 'Customer profile is missing for an existing user.', {
        context: { userId: user.id },
      });
    }

    const token = await this.issueSession(user.id, params.sessionTtlMs, params.ipAddress, params.userAgent);
    await this.users.touchLastLogin(user.id);

    return { user, profile, token };
  }

  /** Called by the customer-auth middleware after extracting the bearer token. */
  async verifySession(rawToken: string): Promise<{ userId: string }> {
    const { userId } = await validateSession(this.sessions, this.tokenHasher, rawToken);
    return { userId };
  }

  async resolveActor(userId: string): Promise<CustomerActor> {
    const user = await this.users.findById(userId);
    if (!user) {
      throw new DomainError('UNAUTHENTICATED', 'No account exists for this session.');
    }
    if (user.status !== 'ACTIVE') {
      throw new DomainError('ACCOUNT_SUSPENDED', 'This account is suspended.');
    }
    const profile = await this.users.findCustomerProfile(user.id);
    if (!profile) {
      throw new DomainError('INTERNAL_ERROR', 'Customer profile is missing for an existing user.', {
        context: { userId: user.id },
      });
    }
    return { kind: 'CUSTOMER', userId: user.id, customerProfileId: profile.id };
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
