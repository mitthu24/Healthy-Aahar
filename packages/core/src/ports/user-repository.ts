import type { BusinessScope } from '../domain/business-scope.js';

/**
 * Identity persistence (docs/07 §3, PHASE 03 email/password).
 *
 * `firebaseUid` is retained as an optional legacy field (rows provisioned
 * before PHASE 03) but is never written by any PHASE 03 code path — the
 * password login identifier is `email`, looked up together with `userType`
 * (the same person may hold both a customer and an admin row).
 */

export type UserType = 'CUSTOMER' | 'ADMIN';
export type AccountStatus = 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';

export type UserRow = {
  id: string;
  firebaseUid: string | null;
  passwordHash: string | null;
  userType: UserType;
  email: string | null;
  phone: string | null;
  emailVerified: boolean;
  phoneVerified: boolean;
  status: AccountStatus;
  lastLoginAt: Date | null;
};

export type CustomerProfileRow = {
  id: string;
  businessId: string;
  userId: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
};

export type CreateCustomerWithPasswordInput = {
  email: string;
  passwordHash: string;
  phone?: string | undefined;
  firstName?: string | undefined;
  lastName?: string | undefined;
};

export type CreateCustomerWithPasswordResult =
  { ok: true; user: UserRow; profile: CustomerProfileRow } | { ok: false; reason: 'EMAIL_TAKEN' };

export interface UserRepository {
  findById(id: string): Promise<UserRow | null>;
  findByEmail(email: string, userType: UserType): Promise<UserRow | null>;
  /** Legacy lookup for rows provisioned before PHASE 03 (Firebase-era). */
  findByFirebaseUid(firebaseUid: string, userType: UserType): Promise<UserRow | null>;
  touchLastLogin(userId: string): Promise<void>;
  setPassword(userId: string, passwordHash: string): Promise<void>;

  /**
   * Creates `users` + `customer_profiles` + the `CUSTOMER_REGISTERED` outbox
   * event in one transaction (docs/07 §4.2). Returns `{ ok: false }` rather
   * than throwing on a duplicate email — registration is an explicit user
   * action, so a collision is a clean 409, never a silent account merge
   * (unlike the PHASE 01/02 OTP "first sign-in" path, which legitimately
   * could merge on an identity race).
   */
  createCustomerWithPassword(
    scope: BusinessScope,
    input: CreateCustomerWithPasswordInput,
  ): Promise<CreateCustomerWithPasswordResult>;

  findCustomerProfile(userId: string): Promise<CustomerProfileRow | null>;
}
