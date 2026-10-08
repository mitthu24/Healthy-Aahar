import type { BusinessScope } from '../domain/business-scope.js';
import type { UserRow } from './user-repository.js';

export type AdminUserRow = {
  id: string;
  businessId: string;
  userId: string;
  firebaseUid: string;
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
  firebaseUid: string;
  email: string;
  fullName: string;
  designation?: string | undefined;
  roleIds: string[];
  invitedByUserId: string;
};

export interface AdminRepository {
  findByFirebaseUid(scope: BusinessScope, firebaseUid: string): Promise<{ user: UserRow; admin: AdminUserRow } | null>;
  findById(scope: BusinessScope, adminUserId: string): Promise<AdminUserRow | null>;
  list(scope: BusinessScope): Promise<AdminUserRow[]>;

  /** Effective permissions = union across every role the admin holds. */
  loadEffectivePermissions(scope: BusinessScope, adminUserId: string): Promise<EffectivePermissions>;

  /** Creates users + admin_users + admin_user_roles in one transaction. */
  invite(scope: BusinessScope, input: InviteAdminInput): Promise<AdminUserRow>;

  /** BR-SEC6: count of ACTIVE (not deleted, not suspended) super admins. */
  countActiveSuperAdmins(scope: BusinessScope): Promise<number>;

  setRoles(scope: BusinessScope, adminUserId: string, roleIds: string[], grantedBy: string): Promise<AdminUserRow>;

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
  create(scope: BusinessScope, input: { key: string; name: string; description?: string; permissionKeys: string[] }): Promise<RoleRow>;
  updatePermissions(scope: BusinessScope, id: string, permissionKeys: string[]): Promise<RoleRow>;
  listAllPermissionKeys(): Promise<string[]>;
}
