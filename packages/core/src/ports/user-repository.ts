import type { BusinessScope } from '../domain/business-scope.js';

/**
 * Identity persistence (docs/07 §3). `firebase_uid` is looked up together
 * with `userType` — the same person may hold both a customer and an admin
 * row, keyed by different Firebase projects (ADR-010).
 */

export type UserType = 'CUSTOMER' | 'ADMIN';
export type AccountStatus = 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';

export type UserRow = {
  id: string;
  firebaseUid: string;
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

export type CreateCustomerInput = {
  firebaseUid: string;
  phone?: string | undefined;
  email?: string | undefined;
  phoneVerified?: boolean | undefined;
  emailVerified?: boolean | undefined;
};

export interface UserRepository {
  findByFirebaseUid(firebaseUid: string, userType: UserType): Promise<UserRow | null>;
  touchLastLogin(userId: string): Promise<void>;

  /**
   * Creates `users` + `customer_profiles` in one transaction and writes the
   * `CUSTOMER_REGISTERED` outbox event (docs/07 §4.2). Returns the existing
   * pair if a concurrent request already created one for the same
   * `firebase_uid` — first-sign-in races must produce exactly one row, never
   * a unique-constraint 500.
   */
  createCustomer(
    scope: BusinessScope,
    input: CreateCustomerInput,
  ): Promise<{ user: UserRow; profile: CustomerProfileRow; created: boolean }>;

  findCustomerProfile(userId: string): Promise<CustomerProfileRow | null>;
}
