import type { BusinessScope } from '../domain/business-scope.js';
import type { UserRow } from './user-repository.js';

export type AdminUserRow = {
  id: string;
  businessId: string;
  userId: string;
  email: string | null;
  fullName: string;
  designation: string | null;
  isSuperAdmin: boolean;
  invitedBy: string | null;
  invitationAcceptedAt: Date | null;
  deletedAt: Date | null;
  roleKeys: string[];
};

export type EffectivePermissions = {
  permissions: string[];
  isSuperAdmin: boolean;
};

export type InviteAdminInput = {
  email: string;
  fullName: string;
  designation?: string | undefined;
  roleIds: string[];
  invitedByUserId: string;
};

/**
 * Fix #3: a duplicate `(email, user_type)` is a real, reachable user error
 * (re-inviting someone, or inviting an email that is already an admin),
 * not a bug — it is reported as a typed result rather than a thrown
 * exception, the same pattern `CreateCustomerWithPasswordResult` already
 * uses, so the service layer can map it to the established
 * `ADMIN_ALREADY_INVITED` code instead of an unhandled 500.
 */
export type InviteAdminResult =
  { ok: true; admin: AdminUserRow } | { ok: false; reason: 'EMAIL_TAKEN' };

export interface AdminRepository {
  findByUserId(
    scope: BusinessScope,
    userId: string,
  ): Promise<{ user: UserRow; admin: AdminUserRow } | null>;
  findById(scope: BusinessScope, adminUserId: string): Promise<AdminUserRow | null>;
  list(scope: BusinessScope): Promise<AdminUserRow[]>;

  /** Effective permissions = union across every role the admin holds. */
  loadEffectivePermissions(
    scope: BusinessScope,
    adminUserId: string,
  ): Promise<EffectivePermissions>;

  /**
   * Creates `users` (no `firebase_uid`, no `password_hash` — set later via
   * the password-setup token flow) + `admin_users` + `admin_user_roles` in
   * one transaction.
   */
  invite(scope: BusinessScope, input: InviteAdminInput): Promise<InviteAdminResult>;

  /** BR-SEC6: count of ACTIVE (not deleted, not suspended) super admins. */
  countActiveSuperAdmins(scope: BusinessScope): Promise<number>;

  setRoles(
    scope: BusinessScope,
    adminUserId: string,
    roleIds: string[],
    grantedBy: string,
  ): Promise<AdminUserRow>;

  /** Soft-deactivates the admin_user row and sets users.status = DEACTIVATED. */
  deactivate(scope: BusinessScope, adminUserId: string): Promise<AdminUserRow>;
}

export type RoleRow = {
  id: string;
  businessId: string;
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissionKeys: string[];
};

export interface RoleRepository {
  list(scope: BusinessScope): Promise<RoleRow[]>;
  findById(scope: BusinessScope, id: string): Promise<RoleRow | null>;
  findByKey(scope: BusinessScope, key: string): Promise<RoleRow | null>;
  create(
    scope: BusinessScope,
    input: { key: string; name: string; description?: string; permissionKeys: string[] },
  ): Promise<RoleRow>;
  updatePermissions(scope: BusinessScope, id: string, permissionKeys: string[]): Promise<RoleRow>;
  listAllPermissionKeys(): Promise<string[]>;
}
