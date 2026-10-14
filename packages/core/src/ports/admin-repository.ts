import type { BusinessScope } from '../domain/business-scope.js';
import type { UserRow } from './user-repository.js';

export type AdminUserRow = {
  id: string;
  businessId: string;
  userId: string;
  email: string | null;
  /** STAGE C: email-free login identifier, see schema.prisma's `User.loginId` doc comment. */
  loginId: string | null;
  fullName: string;
  designation: string | null;
  department: string | null;
  isSuperAdmin: boolean;
  invitedBy: string | null;
  invitationAcceptedAt: Date | null;
  deletedAt: Date | null;
  roleKeys: string[];
  /** Informational/historical only — NOT read by any authorization decision.
   *  See `mustChangePassword` for the actual gate. */
  lastPasswordChangeAt: Date | null;
  /** Explicit, persisted gate (Phase 04 follow-up): true only for an admin
   *  handed a credential someone else chose/knows (today: the first-admin
   *  bootstrap script's temporary password) — never set by the normal
   *  invite flow, where the admin picks their own password at setup. The
   *  admin-auth middleware blocks every route except auth/me, change-
   *  password and logout while this is true. */
  mustChangePassword: boolean;
};

export type EffectivePermissions = {
  permissions: string[];
  isSuperAdmin: boolean;
};

export type InviteAdminInput = {
  /** At least one of `email`/`loginId` must be set — enforced by
   *  `RbacService.inviteAdmin`, not this repository. */
  email?: string | undefined;
  loginId?: string | undefined;
  fullName: string;
  designation?: string | undefined;
  department?: string | undefined;
  roleIds: string[];
  invitedByUserId: string;
};

export type UpdateAdminDetailsInput = {
  fullName?: string | undefined;
  designation?: string | undefined;
  department?: string | undefined;
};

export type AdminUserListFilter = {
  /** Case-insensitive substring match against full name or email. */
  q?: string | undefined;
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
  | { ok: true; admin: AdminUserRow }
  | { ok: false; reason: 'EMAIL_TAKEN' | 'LOGIN_ID_TAKEN' };

export interface AdminRepository {
  findByUserId(
    scope: BusinessScope,
    userId: string,
  ): Promise<{ user: UserRow; admin: AdminUserRow } | null>;
  findById(scope: BusinessScope, adminUserId: string): Promise<AdminUserRow | null>;
  list(scope: BusinessScope, filter?: AdminUserListFilter): Promise<AdminUserRow[]>;

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

  /** Reverses `deactivate`: clears `deleted_at` and sets users.status = ACTIVE. */
  reactivate(scope: BusinessScope, adminUserId: string): Promise<AdminUserRow>;

  /** Updates own-record fields only — never roles or super-admin status (see `setRoles`). */
  update(
    scope: BusinessScope,
    adminUserId: string,
    input: UpdateAdminDetailsInput,
  ): Promise<AdminUserRow>;

  /** Stamps `last_password_change_at`, clearing the "must change password" signal. */
  markPasswordChanged(scope: BusinessScope, adminUserId: string): Promise<void>;
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
