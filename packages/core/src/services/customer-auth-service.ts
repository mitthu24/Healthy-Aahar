import type { BusinessScope } from '../domain/business-scope.js';
import { DomainError } from '../domain/errors.js';
import type { CustomerProfileRow, UserRepository, UserRow } from '../ports/user-repository.js';

export type CustomerActor = {
  kind: 'CUSTOMER';
  userId: string;
  customerProfileId: string;
};

export type CustomerSessionResult = {
  user: UserRow;
  profile: CustomerProfileRow;
  created: boolean;
};

/**
 * Customer session exchange (docs/07 §4.2).
 *
 * `/v1/auth/session` is the ONLY place a `users` row may be created for a
 * customer. Every other customer-authenticated route resolves an EXISTING
 * user and rejects with 401 if none is found — this asymmetry is deliberate,
 * not an oversight (docs/07 §6 step 4).
 */
export class CustomerAuthService {
  constructor(private readonly users: UserRepository) {}

  /** Called by POST /v1/auth/session after the bearer token is verified. */
  async createOrResumeSession(
    scope: BusinessScope,
    identity: { firebaseUid: string; phoneNumber?: string; email?: string },
  ): Promise<CustomerSessionResult> {
    const existing = await this.users.findByFirebaseUid(identity.firebaseUid, 'CUSTOMER');

    if (existing) {
      if (existing.status !== 'ACTIVE') {
        throw new DomainError('ACCOUNT_SUSPENDED', 'This account is suspended.');
      }
      await this.users.touchLastLogin(existing.id);
      const profile = await this.users.findCustomerProfile(existing.id);
      if (!profile) {
        // Should never happen — users and customer_profiles are created
        // together. Fail loudly rather than silently returning a user with
        // no profile, which every downstream query assumes exists.
        throw new DomainError('INTERNAL_ERROR', 'Customer profile is missing for an existing user.', {
          context: { userId: existing.id },
        });
      }
      return { user: existing, profile, created: false };
    }

    const { user, profile, created } = await this.users.createCustomer(scope, {
      firebaseUid: identity.firebaseUid,
      phone: identity.phoneNumber,
      email: identity.email,
      phoneVerified: Boolean(identity.phoneNumber),
      emailVerified: Boolean(identity.email),
    });

    return { user, profile, created };
  }

  /** Used by every OTHER customer route (docs/07 §6 step 4). */
  async resolveActor(firebaseUid: string): Promise<CustomerActor> {
    const user = await this.users.findByFirebaseUid(firebaseUid, 'CUSTOMER');
    if (!user) {
      throw new DomainError('UNAUTHENTICATED', 'No account exists for this token. Call POST /v1/auth/session first.');
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
}
