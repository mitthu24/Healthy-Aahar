import type { BusinessScope } from '../domain/business-scope.js';
import { DomainError } from '../domain/errors.js';
import { isKnownPermission } from '../domain/permissions.js';
import type { AdminRepository, AdminUserRow, RoleRepository, RoleRow } from '../ports/admin-repository.js';
import type { AuditLogRepository } from '../ports/audit-log-repository.js';
import type { SessionRepository } from '../ports/session-repository.js';
import type { PasswordResetService } from './password-reset-service.js';

/**
 * RBAC administration: invite/deactivate staff, assign roles, manage roles
 * (docs/08 §6). Every write here is audited and every invariant in docs/08
 * §6 is enforced in this layer, not trusted to callers.
 *
 * PHASE 03 (email/password): inviting an admin no longer calls out to
 * Firebase — it creates the `users` row directly (no password yet) and
 * issues a password-setup token through `PasswordResetService` (Fix #2 —
 * the single authorized issuance path; see that class's doc comment).
 * Deactivating an admin revokes every DB-backed session for that user
 * instead of disabling a Firebase account. `resetAdminPassword` (Fix #2)
 * is the authorized workflow for an EXISTING admin who needs a new
 * password-setup token — invite cannot be reused for this (it always
 * creates a new user row, which collides on the existing one's email).
 */
export class RbacService {
  constructor(
    /** Exposed read-only for simple list/find routes that need no invariant checks. */
    readonly admins: AdminRepository,
    readonly roles: RoleRepository,
    private readonly passwordReset: PasswordResetService,
    private readonly sessions: SessionRepository,
    private readonly audit: AuditLogRepository,
  ) {}

  async inviteAdmin(
    scope: BusinessScope,
    params: {
      email: string;
      fullName: string;
      designation?: string;
      roleIds: string[];
      invitedByUserId: string;
      invitedByIsSuperAdmin: boolean;
      /** Base URL the caller appends `?token=<raw>` to, e.g. the admin app's "set password" page. */
      passwordResetContinueUrl?: string;
    },
  ): Promise<{ admin: AdminUserRow; passwordResetLink: string }> {
    const roles = await this.loadRolesOrThrow(scope, params.roleIds);
    this.assertMayGrant(roles, params.invitedByIsSuperAdmin);

    const result = await this.admins.invite(scope, {
      email: params.email,
      fullName: params.fullName,
      designation: params.designation,
      roleIds: params.roleIds,
      invitedByUserId: params.invitedByUserId,
    });

    // Fix #3: a duplicate (email, user_type) is a real, reachable user
    // error (re-inviting someone, or inviting an email that is already an
    // admin) — it must map to the established 409, never fall through to a
    // raw, unhandled 500.
    if (!result.ok) {
      throw new DomainError('ADMIN_ALREADY_INVITED', 'An admin account with this email already exists.');
    }
    const admin = result.admin;

    const passwordResetLink = await this.passwordReset.issueToken({
      userId: admin.userId,
      purpose: 'SETUP',
      continueUrl: params.passwordResetContinueUrl,
    });

    await this.audit.write(scope, {
      actorUserId: params.invitedByUserId,
      actorType: 'ADMIN',
      action: 'admin_user.invited',
      resourceType: 'admin_user',
      resourceId: admin.id,
      metadata: { email: params.email, roles: roles.map((r) => r.key) },
    });

    return { admin, passwordResetLink };
  }

  /**
   * Fix #2 — the authorized workflow for an EXISTING admin (already has a
   * `users` + `admin_users` row) to obtain a new password-setup token:
   * typically because they never completed setup, or forgot their
   * password. Gated by `admin_users:update` at the route layer — the same
   * permission that already gates changing another admin's roles, which is
   * comparably sensitive (it does not reveal or set a password itself,
   * only mints a token someone must still redeem).
   */
  async resetAdminPassword(
    scope: BusinessScope,
    params: { targetAdminUserId: string; actorUserId: string; passwordResetContinueUrl?: string },
  ): Promise<{ passwordResetLink: string }> {
    const target = await this.admins.findById(scope, params.targetAdminUserId);
    if (!target || target.deletedAt) {
      throw new DomainError('NOT_FOUND', 'Admin user not found.');
    }

    const passwordResetLink = await this.passwordReset.issueToken({
      userId: target.userId,
      purpose: 'RESET',
      continueUrl: params.passwordResetContinueUrl,
    });

    await this.audit.write(scope, {
      actorUserId: params.actorUserId,
      actorType: 'ADMIN',
      action: 'admin_user.password_reset_issued',
      resourceType: 'admin_user',
      resourceId: target.id,
    });

    return { passwordResetLink };
  }

  async setRoles(
    scope: BusinessScope,
    params: {
      targetAdminUserId: string;
      roleIds: string[];
      actorAdminUserId: string;
      actorUserId: string;
      actorIsSuperAdmin: boolean;
    },
  ): Promise<AdminUserRow> {
    // BR-SEC8: an admin cannot modify their own roles, super admin included —
    // this prevents an account from escalating or protecting itself.
    if (params.targetAdminUserId === params.actorAdminUserId) {
      throw new DomainError('CANNOT_MODIFY_OWN_ROLES', 'You cannot change your own roles.');
    }

    const target = await this.admins.findById(scope, params.targetAdminUserId);
    if (!target) throw new DomainError('NOT_FOUND', 'Admin user not found.');

    const roles = await this.loadRolesOrThrow(scope, params.roleIds);
    this.assertMayGrant(roles, params.actorIsSuperAdmin);

    // BR-SEC6: revoking Super Admin here must not drop the last active one.
    const grantsSuperAdmin = roles.some((r) => r.key === 'SUPER_ADMIN');
    const losingSuperAdmin = target.isSuperAdmin && !grantsSuperAdmin;
    if (losingSuperAdmin) {
      const activeCount = await this.admins.countActiveSuperAdmins(scope);
      if (activeCount <= 1) {
        throw new DomainError('LAST_SUPER_ADMIN', 'At least one active Super Admin must always exist.');
      }
    }

    const updated = await this.admins.setRoles(scope, params.targetAdminUserId, params.roleIds, params.actorUserId);

    await this.audit.write(scope, {
      actorUserId: params.actorUserId,
      actorType: 'ADMIN',
      action: 'admin_user.roles_changed',
      resourceType: 'admin_user',
      resourceId: params.targetAdminUserId,
      metadata: { roles: roles.map((r) => r.key) },
    });

    return updated;
  }

  async deactivate(
    scope: BusinessScope,
    params: { targetAdminUserId: string; actorUserId: string },
  ): Promise<AdminUserRow> {
    const target = await this.admins.findById(scope, params.targetAdminUserId);
    if (!target) throw new DomainError('NOT_FOUND', 'Admin user not found.');

    // BR-SEC6, deactivation path.
    if (target.isSuperAdmin) {
      const activeCount = await this.admins.countActiveSuperAdmins(scope);
      if (activeCount <= 1) {
        throw new DomainError('LAST_SUPER_ADMIN', 'At least one active Super Admin must always exist.');
      }
    }

    const updated = await this.admins.deactivate(scope, params.targetAdminUserId);

    // BR-SEC10: revoke every DB-backed session in the same operation, not a
    // best-effort follow-up.
    await this.sessions.revokeAllForUser(target.userId);

    await this.audit.write(scope, {
      actorUserId: params.actorUserId,
      actorType: 'ADMIN',
      action: 'admin_user.deactivated',
      resourceType: 'admin_user',
      resourceId: params.targetAdminUserId,
    });

    return updated;
  }

  async createRole(
    scope: BusinessScope,
    params: { key: string; name: string; description?: string; permissionKeys: string[] },
    actorUserId: string,
  ): Promise<RoleRow> {
    this.assertKnownPermissions(params.permissionKeys);

    const created = await this.roles.create(scope, params);

    await this.audit.write(scope, {
      actorUserId,
      actorType: 'ADMIN',
      action: 'role.created',
      resourceType: 'role',
      resourceId: created.id,
      metadata: { key: created.key, permissions: params.permissionKeys },
    });

    return created;
  }

  async updateRolePermissions(
    scope: BusinessScope,
    params: { roleId: string; permissionKeys: string[]; actorUserId: string; actorIsSuperAdmin: boolean },
  ): Promise<RoleRow> {
    this.assertKnownPermissions(params.permissionKeys);

    // roles:manage is itself Super-Admin-only (doc 08 §2, "Administration"
    // table) — a route-level check enforces this too, but a role's
    // permission SET is exactly the thing that could grant it, so it is
    // re-checked here as well (defence in depth, not redundancy).
    if (params.permissionKeys.includes('roles:manage') && !params.actorIsSuperAdmin) {
      throw new DomainError('FORBIDDEN', 'Only a Super Admin may grant role management.');
    }

    const updated = await this.roles.updatePermissions(scope, params.roleId, params.permissionKeys);

    await this.audit.write(scope, {
      actorUserId: params.actorUserId,
      actorType: 'ADMIN',
      action: 'role.permissions_changed',
      resourceType: 'role',
      resourceId: params.roleId,
      metadata: { permissions: params.permissionKeys },
    });

    return updated;
  }

  private assertMayGrant(roles: RoleRow[], actorIsSuperAdmin: boolean): void {
    // BR-SEC7: only a Super Admin may grant roles:manage or create/promote a
    // Super Admin. Checked explicitly rather than derived from a permission
    // key, because this IS the privilege-escalation boundary.
    const grantsRolesManage = roles.some((r) => r.permissionKeys.includes('roles:manage'));
    const grantsSuperAdmin = roles.some((r) => r.key === 'SUPER_ADMIN');
    if ((grantsRolesManage || grantsSuperAdmin) && !actorIsSuperAdmin) {
      throw new DomainError('FORBIDDEN', 'Only a Super Admin may grant role management or Super Admin access.');
    }
  }

  private assertKnownPermissions(keys: string[]): void {
    const unknown = keys.filter((k) => !isKnownPermission(k));
    if (unknown.length > 0) {
      throw new DomainError('UNKNOWN_PERMISSION', `Unknown permission key(s): ${unknown.join(', ')}`, {
        details: unknown.map((k) => ({ field: 'permission_keys', issue: `unknown permission "${k}"` })),
      });
    }
  }

  private async loadRolesOrThrow(scope: BusinessScope, roleIds: string[]): Promise<RoleRow[]> {
    if (roleIds.length === 0) {
      throw new DomainError('VALIDATION_FAILED', 'At least one role is required.');
    }
    const resolved = await Promise.all(roleIds.map((id) => this.roles.findById(scope, id)));
    const missing = roleIds.filter((_, i) => !resolved[i]);
    if (missing.length > 0) {
      throw new DomainError('VALIDATION_FAILED', `Unknown role id(s): ${missing.join(', ')}`);
    }
    return resolved as RoleRow[];
  }
}
