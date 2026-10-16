import type { BusinessScope } from '../domain/business-scope.js';
import { DomainError } from '../domain/errors.js';
import { isKnownPermission } from '../domain/permissions.js';
import type {
  AdminRepository,
  AdminUserRow,
  RoleRepository,
  RoleRow,
} from '../ports/admin-repository.js';
import type { AuditLogRepository } from '../ports/audit-log-repository.js';
import type { EmailChannel } from '../ports/email-channel.js';
import type { PasswordHasher } from '../ports/password-hasher.js';
import type { SessionRepository } from '../ports/session-repository.js';
import type { UserRepository } from '../ports/user-repository.js';
import type { PasswordResetService } from './password-reset-service.js';

/** Stage F deps, appended rather than inserted — keeps every existing
 *  positional `new RbacService(...)` call site (several in tests) valid
 *  without updating each one; only the two new flows below need them. */
export type RbacServiceStageFDeps = {
  users: UserRepository;
  passwordHasher: PasswordHasher;
  generateTemporaryPassword: () => string;
  /** Omitted = password-reset emails are never attempted; the route layer
   *  reports this honestly as "not configured" rather than claiming SENT. */
  emailChannel?: EmailChannel;
};

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
    private readonly stageF?: RbacServiceStageFDeps,
  ) {}

  async inviteAdmin(
    scope: BusinessScope,
    params: {
      email?: string;
      /** STAGE C: email-free login identifier — format/normalization is
       *  already enforced by `inviteAdminBodySchema`/`createDeliveryPartnerBodySchema`
       *  before this is called; this layer only enforces the at-least-one-of
       *  invariant below. */
      loginId?: string;
      /** STAGE E: unique within the business when given — enforced here (not
       *  just by the DB) so a collision maps to a clear 409 rather than an
       *  unhandled constraint error. The staff-invite contract requires this;
       *  the delivery-partner creation flow (also routed through here) does
       *  not. */
      employeeCode?: string;
      fullName: string;
      designation?: string;
      department?: string;
      roleIds: string[];
      invitedByUserId: string;
      invitedByIsSuperAdmin: boolean;
      /** Base URL the caller appends `?token=<raw>` to, e.g. the admin app's "set password" page. */
      passwordResetContinueUrl?: string;
      /**
       * STAGE F: an admin-chosen initial password, as an alternative to the
       * setup-link flow (both remain supported — see `inviteAdminBodySchema`).
       * When given, the account is created with this password already set
       * (hashed via the same approved hasher every other credential in this
       * system uses) and `mustChangePassword = true`, so the employee must
       * choose their own password at first login before reaching anything
       * else — the admin's choice is never usable beyond that first sign-in.
       * No setup-link token is issued in this branch; there is nothing left
       * for it to authorize.
       */
      initialPassword?: string;
    },
  ): Promise<{ admin: AdminUserRow; passwordResetLink: string | null }> {
    if (!params.email && !params.loginId) {
      throw new DomainError(
        'VALIDATION_FAILED',
        'An email or a login ID is required to create an account.',
      );
    }

    const roles = await this.loadRolesOrThrow(scope, params.roleIds);
    this.assertMayGrant(roles, params.invitedByIsSuperAdmin);

    let passwordHash: string | undefined;
    if (params.initialPassword !== undefined) {
      if (!this.stageF) {
        throw new Error('RbacService: initialPassword requires Stage F deps to be configured.');
      }
      const weakness = this.stageF.passwordHasher.checkStrength(params.initialPassword);
      if (weakness) throw new DomainError('WEAK_PASSWORD', weakness);
      passwordHash = await this.stageF.passwordHasher.hash(params.initialPassword);
    }

    const result = await this.admins.invite(scope, {
      email: params.email,
      loginId: params.loginId,
      employeeCode: params.employeeCode,
      fullName: params.fullName,
      designation: params.designation,
      department: params.department,
      roleIds: params.roleIds,
      invitedByUserId: params.invitedByUserId,
      passwordHash,
      mustChangePassword: passwordHash !== undefined,
    });

    // Fix #3: a duplicate (email, user_type) / (login_id, user_type) /
    // (business_id, employee_code) is a real, reachable user error
    // (re-inviting someone, or an identifier that is already taken) — it
    // must map to the established 409, never fall through to a raw,
    // unhandled 500.
    if (!result.ok) {
      if (result.reason === 'LOGIN_ID_TAKEN') {
        throw new DomainError('LOGIN_ID_TAKEN', 'This login ID is already taken.');
      }
      if (result.reason === 'EMPLOYEE_CODE_TAKEN') {
        throw new DomainError('EMPLOYEE_CODE_TAKEN', 'This employee ID is already taken.');
      }
      throw new DomainError(
        'ADMIN_ALREADY_INVITED',
        'An admin account with this email already exists.',
      );
    }
    const admin = result.admin;

    // A password was set directly — no setup token needed or issued.
    const passwordResetLink =
      passwordHash === undefined
        ? await this.passwordReset.issueToken({
            userId: admin.userId,
            purpose: 'SETUP',
            continueUrl: params.passwordResetContinueUrl,
          })
        : null;

    await this.audit.write(scope, {
      actorUserId: params.invitedByUserId,
      actorType: 'ADMIN',
      action: 'admin_user.invited',
      resourceType: 'admin_user',
      resourceId: admin.id,
      metadata: {
        email: params.email,
        login_id: params.loginId,
        employee_code: params.employeeCode,
        roles: roles.map((r) => r.key),
        // Never the password itself — only whether this invite used one.
        used_initial_password: passwordHash !== undefined,
      },
    });

    return { admin, passwordResetLink };
  }

  /**
   * Stage F — "Generate temporary password": an authorized admin generates
   * a one-time credential for an EXISTING employee, as an alternative to
   * `resetAdminPassword`'s email/link flow (e.g. when the employee is
   * standing right there, or email isn't configured). The plaintext is
   * returned to the caller EXACTLY ONCE — nothing here logs it, and only
   * its hash is ever persisted (`UserRepository.setPassword`, the same
   * single write path `PasswordResetService.setPassword` uses). Every
   * existing session is revoked, matching `resetAdminPassword`/
   * `deactivate`'s convention: a credential change must not leave an old
   * session usable. Subject to the same `assertMayManageTarget` boundary as
   * every other sensitive action on another admin's account — a
   * non-Super-Admin cannot do this to a Super Admin, same as it cannot
   * reset one's password or deactivate one.
   */
  async generateTemporaryPassword(
    scope: BusinessScope,
    params: { targetAdminUserId: string; actorUserId: string; actorIsSuperAdmin: boolean },
  ): Promise<{ temporaryPassword: string }> {
    if (!this.stageF) {
      throw new Error('RbacService: generateTemporaryPassword requires Stage F deps.');
    }

    const target = await this.admins.findById(scope, params.targetAdminUserId);
    if (!target || target.deletedAt) {
      throw new DomainError('NOT_FOUND', 'Admin user not found.');
    }
    this.assertMayManageTarget(target, params.actorIsSuperAdmin);

    const temporaryPassword = this.stageF.generateTemporaryPassword();
    const passwordHash = await this.stageF.passwordHasher.hash(temporaryPassword);

    await this.stageF.users.setPassword(target.userId, passwordHash);
    await this.admins.setMustChangePassword(scope, target.id, true);
    await this.sessions.revokeAllForUser(target.userId);

    await this.audit.write(scope, {
      actorUserId: params.actorUserId,
      actorType: 'ADMIN',
      action: 'admin_user.temporary_password_generated',
      resourceType: 'admin_user',
      resourceId: target.id,
      // Who did it, on whom — never the password itself.
    });

    return { temporaryPassword };
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
    params: {
      targetAdminUserId: string;
      actorUserId: string;
      actorIsSuperAdmin: boolean;
      passwordResetContinueUrl?: string;
    },
  ): Promise<{ passwordResetLink: string; emailStatus: 'SENT' | 'SKIPPED' | 'FAILED' }> {
    const target = await this.admins.findById(scope, params.targetAdminUserId);
    if (!target || target.deletedAt) {
      throw new DomainError('NOT_FOUND', 'Admin user not found.');
    }
    this.assertMayManageTarget(target, params.actorIsSuperAdmin);

    const passwordResetLink = await this.passwordReset.issueToken({
      userId: target.userId,
      purpose: 'RESET',
      continueUrl: params.passwordResetContinueUrl,
    });

    // Stage F: actually attempt delivery through the configured channel,
    // rather than only ever handing the link back for the admin to copy —
    // reported HONESTLY either way (never claims SENT when it wasn't; see
    // `EmailChannel`'s doc comment for why no real provider exists yet in
    // every environment). The link itself is still always returned too, as
    // a fallback the admin can relay manually regardless of email status.
    let emailStatus: 'SENT' | 'SKIPPED' | 'FAILED' = 'SKIPPED';
    if (this.stageF?.emailChannel && target.email) {
      const result = await this.stageF.emailChannel.send({
        recipient: { userId: target.userId, email: target.email },
        templateKey: 'admin_password_reset',
        variables: { full_name: target.fullName, reset_link: passwordResetLink },
        locale: 'en-IN',
        dedupeKey: `admin_password_reset:${target.userId}:${Date.now()}`,
      });
      emailStatus =
        result.status === 'SENT' ? 'SENT' : result.status === 'FAILED' ? 'FAILED' : 'SKIPPED';
    }

    await this.audit.write(scope, {
      actorUserId: params.actorUserId,
      actorType: 'ADMIN',
      action: 'admin_user.password_reset_issued',
      resourceType: 'admin_user',
      resourceId: target.id,
      metadata: { email_status: emailStatus },
    });

    return { passwordResetLink, emailStatus };
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
    this.assertMayManageTarget(target, params.actorIsSuperAdmin);

    const roles = await this.loadRolesOrThrow(scope, params.roleIds);
    this.assertMayGrant(roles, params.actorIsSuperAdmin);

    // BR-SEC6: revoking Super Admin here must not drop the last active one.
    const grantsSuperAdmin = roles.some((r) => r.key === 'SUPER_ADMIN');
    const losingSuperAdmin = target.isSuperAdmin && !grantsSuperAdmin;
    if (losingSuperAdmin) {
      const activeCount = await this.admins.countActiveSuperAdmins(scope);
      if (activeCount <= 1) {
        throw new DomainError(
          'LAST_SUPER_ADMIN',
          'At least one active Super Admin must always exist.',
        );
      }
    }

    const updated = await this.admins.setRoles(
      scope,
      params.targetAdminUserId,
      params.roleIds,
      params.actorUserId,
    );

    // A role change can both grant AND revoke permissions the target's
    // current session already carries (permissions are loaded per-request
    // from the DB today, but a session-level cache is exactly the kind of
    // thing that gets added later without anyone remembering to revisit
    // this call site) — revoking forces immediate reauthentication under
    // the new role set rather than leaving that to chance.
    await this.sessions.revokeAllForUser(target.userId);

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

  /**
   * Updates an admin's own-record fields (name, designation, department).
   * Never roles or super-admin status — that remains exclusively
   * `setRoles`'s job, with its own privilege-escalation and last-super-admin
   * guards. No self-edit restriction: an admin editing their own displayed
   * name is not a security boundary the way role changes are.
   */
  async updateDetails(
    scope: BusinessScope,
    params: {
      targetAdminUserId: string;
      fullName?: string;
      designation?: string;
      department?: string;
      employeeCode?: string;
      actorUserId: string;
      actorIsSuperAdmin: boolean;
    },
  ): Promise<AdminUserRow> {
    const target = await this.admins.findById(scope, params.targetAdminUserId);
    if (!target) throw new DomainError('NOT_FOUND', 'Admin user not found.');
    this.assertMayManageTarget(target, params.actorIsSuperAdmin);

    const updated = await this.admins.update(scope, params.targetAdminUserId, {
      fullName: params.fullName,
      designation: params.designation,
      department: params.department,
      employeeCode: params.employeeCode,
    });

    await this.audit.write(scope, {
      actorUserId: params.actorUserId,
      actorType: 'ADMIN',
      action: 'admin_user.updated',
      resourceType: 'admin_user',
      resourceId: params.targetAdminUserId,
      metadata: {
        full_name: params.fullName,
        designation: params.designation,
        department: params.department,
      },
    });

    return updated;
  }

  async deactivate(
    scope: BusinessScope,
    params: {
      targetAdminUserId: string;
      actorAdminUserId: string;
      actorUserId: string;
      actorIsSuperAdmin: boolean;
    },
  ): Promise<AdminUserRow> {
    const target = await this.admins.findById(scope, params.targetAdminUserId);
    if (!target) throw new DomainError('NOT_FOUND', 'Admin user not found.');
    this.assertMayManageTarget(target, params.actorIsSuperAdmin);

    // BR-SEC6, deactivation path. Checked before the self-deactivation guard
    // below: the sole active Super Admin deactivating themselves must still
    // surface as LAST_SUPER_ADMIN, matching the established contract.
    if (target.isSuperAdmin) {
      const activeCount = await this.admins.countActiveSuperAdmins(scope);
      if (activeCount <= 1) {
        throw new DomainError(
          'LAST_SUPER_ADMIN',
          'At least one active Super Admin must always exist.',
        );
      }
    }

    // An admin cannot deactivate their own account otherwise — the obvious
    // way to defeat BR-SEC6's guard would be for a Super Admin (who isn't
    // the last one) to simply deactivate someone else down to a count the
    // guard still permits, but a self-lockout (or a non-super-admin cutting
    // off their own access) is its own failure mode worth refusing outright.
    if (params.targetAdminUserId === params.actorAdminUserId) {
      throw new DomainError('CANNOT_DEACTIVATE_SELF', 'You cannot deactivate your own account.');
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

  /**
   * Reverses `deactivate`. Does not restore any session — the admin signs
   * in fresh through the normal login flow, the same as any other account
   * returning to ACTIVE status.
   */
  async reactivate(
    scope: BusinessScope,
    params: { targetAdminUserId: string; actorUserId: string; actorIsSuperAdmin: boolean },
  ): Promise<AdminUserRow> {
    const target = await this.admins.findById(scope, params.targetAdminUserId);
    if (!target) throw new DomainError('NOT_FOUND', 'Admin user not found.');
    this.assertMayManageTarget(target, params.actorIsSuperAdmin);
    if (!target.deletedAt) {
      throw new DomainError('VALIDATION_FAILED', 'This account is already active.');
    }

    const updated = await this.admins.reactivate(scope, params.targetAdminUserId);

    await this.audit.write(scope, {
      actorUserId: params.actorUserId,
      actorType: 'ADMIN',
      action: 'admin_user.reactivated',
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
    params: {
      roleId: string;
      permissionKeys: string[];
      actorUserId: string;
      actorIsSuperAdmin: boolean;
    },
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

  /**
   * STAGE E: a non-Super-Admin holding `admin_users:update` could otherwise
   * reset, edit, deactivate or reactivate ANY other admin — including
   * another Super Admin, whose access is meant to be the harder boundary.
   * Mirrors `assertMayGrant`'s shape: only a Super Admin may act on a
   * target that is itself a Super Admin; any admin may still act on a
   * non-Super-Admin target (unchanged from before this guard existed).
   */
  private assertMayManageTarget(target: AdminUserRow, actorIsSuperAdmin: boolean): void {
    if (target.isSuperAdmin && !actorIsSuperAdmin) {
      throw new DomainError(
        'CANNOT_MANAGE_SUPER_ADMIN',
        'Only a Super Admin may manage another Super Admin’s account.',
      );
    }
  }

  private assertMayGrant(roles: RoleRow[], actorIsSuperAdmin: boolean): void {
    // BR-SEC7: only a Super Admin may grant roles:manage or create/promote a
    // Super Admin. Checked explicitly rather than derived from a permission
    // key, because this IS the privilege-escalation boundary.
    const grantsRolesManage = roles.some((r) => r.permissionKeys.includes('roles:manage'));
    const grantsSuperAdmin = roles.some((r) => r.key === 'SUPER_ADMIN');
    if ((grantsRolesManage || grantsSuperAdmin) && !actorIsSuperAdmin) {
      throw new DomainError(
        'FORBIDDEN',
        'Only a Super Admin may grant role management or Super Admin access.',
      );
    }
  }

  private assertKnownPermissions(keys: string[]): void {
    const unknown = keys.filter((k) => !isKnownPermission(k));
    if (unknown.length > 0) {
      throw new DomainError(
        'UNKNOWN_PERMISSION',
        `Unknown permission key(s): ${unknown.join(', ')}`,
        {
          details: unknown.map((k) => ({
            field: 'permission_keys',
            issue: `unknown permission "${k}"`,
          })),
        },
      );
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
