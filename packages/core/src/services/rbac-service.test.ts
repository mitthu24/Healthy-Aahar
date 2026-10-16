import { beforeEach, describe, expect, it } from 'vitest';

import { businessScope, type BusinessScope } from '../domain/business-scope.js';
import { now } from '../domain/time.js';
import type {
  AdminRepository,
  AdminUserListFilter,
  AdminUserRow,
  EffectivePermissions,
  InviteAdminInput,
  InviteAdminResult,
  RoleRepository,
  RoleRow,
  UpdateAdminDetailsInput,
} from '../ports/admin-repository.js';
import type { AuditEvent, AuditLogRepository } from '../ports/audit-log-repository.js';
import type {
  CreateSessionInput,
  SessionRepository,
  SessionRow,
} from '../ports/session-repository.js';
import type { PasswordResetService } from './password-reset-service.js';
import { RbacService } from './rbac-service.js';

/**
 * Phase 05 hotfix coverage: the invariants added alongside employee
 * management — self-deactivation refused, a role change invalidates
 * existing sessions, reactivate reverses deactivate, updateDetails never
 * touches roles/super-admin status. Pre-existing invariants (last-super-
 * admin, self-role-edit, privilege escalation) already had no test file
 * before this; adding light coverage for those too rather than only the
 * new behavior.
 */

const BUSINESS_ID = businessScope('0193aaaa-0000-7000-8000-00000000000b');
const ACTOR_USER_ID = '0193bbbb-0000-7000-8000-000000000001';
const ACTOR_ADMIN_ID = '0193bbbb-0000-7000-8000-000000000002';

function row(overrides: Partial<AdminUserRow> = {}): AdminUserRow {
  return {
    id: '0193cccc-0000-7000-8000-000000000001',
    businessId: BUSINESS_ID,
    userId: '0193dddd-0000-7000-8000-000000000001',
    email: 'staff@example.test',
    loginId: null,
    employeeCode: null,
    fullName: 'Staff Member',
    designation: null,
    department: null,
    isSuperAdmin: false,
    invitedBy: null,
    invitationAcceptedAt: null,
    deletedAt: null,
    roleKeys: ['OPERATIONS'],
    lastPasswordChangeAt: null,
    mustChangePassword: false,
    ...overrides,
  };
}

class FakeAdminRepository implements AdminRepository {
  rows = new Map<string, AdminUserRow>();
  activeSuperAdminCount = 1;
  updateCalls: Array<{ id: string; input: UpdateAdminDetailsInput }> = [];
  setRolesCalls: Array<{ id: string; roleIds: string[] }> = [];

  async findByUserId() {
    return null;
  }
  async findById(_scope: BusinessScope, id: string): Promise<AdminUserRow | null> {
    return this.rows.get(id) ?? null;
  }
  async list(_scope: BusinessScope, _filter?: AdminUserListFilter): Promise<AdminUserRow[]> {
    return [...this.rows.values()];
  }
  async loadEffectivePermissions(): Promise<EffectivePermissions> {
    return { permissions: [], isSuperAdmin: false };
  }
  invitedWith: InviteAdminInput[] = [];
  async invite(_scope: BusinessScope, input: InviteAdminInput): Promise<InviteAdminResult> {
    this.invitedWith.push(input);
    const taken = [...this.rows.values()].some(
      (r) =>
        (input.email && r.email === input.email) || (input.loginId && r.loginId === input.loginId),
    );
    if (taken) {
      return { ok: false, reason: input.loginId ? 'LOGIN_ID_TAKEN' : 'EMAIL_TAKEN' };
    }
    const id = `admin-${this.rows.size + 1}`;
    const created = row({
      id,
      userId: `user-${id}`,
      email: input.email ?? null,
      loginId: input.loginId ?? null,
      fullName: input.fullName,
      designation: input.designation ?? null,
      department: input.department ?? null,
      invitedBy: input.invitedByUserId,
      roleKeys: [],
    });
    this.rows.set(id, created);
    return { ok: true, admin: created };
  }
  async countActiveSuperAdmins(): Promise<number> {
    return this.activeSuperAdminCount;
  }
  async setRoles(
    _scope: BusinessScope,
    adminUserId: string,
    roleIds: string[],
  ): Promise<AdminUserRow> {
    this.setRolesCalls.push({ id: adminUserId, roleIds });
    const existing = this.rows.get(adminUserId);
    if (!existing) throw new Error('not found');
    const updated = { ...existing, roleKeys: roleIds, isSuperAdmin: roleIds.includes('super') };
    this.rows.set(adminUserId, updated);
    return updated;
  }
  async deactivate(_scope: BusinessScope, adminUserId: string): Promise<AdminUserRow> {
    const existing = this.rows.get(adminUserId);
    if (!existing) throw new Error('not found');
    const updated = { ...existing, deletedAt: now() };
    this.rows.set(adminUserId, updated);
    return updated;
  }
  async reactivate(_scope: BusinessScope, adminUserId: string): Promise<AdminUserRow> {
    const existing = this.rows.get(adminUserId);
    if (!existing) throw new Error('not found');
    const updated = { ...existing, deletedAt: null };
    this.rows.set(adminUserId, updated);
    return updated;
  }
  async update(
    _scope: BusinessScope,
    adminUserId: string,
    input: UpdateAdminDetailsInput,
  ): Promise<AdminUserRow> {
    this.updateCalls.push({ id: adminUserId, input });
    const existing = this.rows.get(adminUserId);
    if (!existing) throw new Error('not found');
    const updated = {
      ...existing,
      fullName: input.fullName ?? existing.fullName,
      designation: input.designation ?? existing.designation,
      department: input.department ?? existing.department,
    };
    this.rows.set(adminUserId, updated);
    return updated;
  }
  async markPasswordChanged(): Promise<void> {}
  async setMustChangePassword(): Promise<void> {}
}

class FakeRoleRepository implements RoleRepository {
  roles = new Map<string, RoleRow>();
  async list(): Promise<RoleRow[]> {
    return [...this.roles.values()];
  }
  async findById(_scope: BusinessScope, id: string): Promise<RoleRow | null> {
    return this.roles.get(id) ?? null;
  }
  async findByKey(): Promise<RoleRow | null> {
    return null;
  }
  async create(): Promise<RoleRow> {
    throw new Error('not used in these tests');
  }
  async updatePermissions(): Promise<RoleRow> {
    throw new Error('not used in these tests');
  }
  async listAllPermissionKeys(): Promise<string[]> {
    return [];
  }
}

function roleRow(overrides: Partial<RoleRow> = {}): RoleRow {
  return {
    id: '0193eeee-0000-7000-8000-000000000001',
    businessId: BUSINESS_ID,
    key: 'OPERATIONS',
    name: 'Operations',
    description: null,
    isSystem: false,
    permissionKeys: ['orders:read'],
    ...overrides,
  };
}

class FakeSessionRepository implements SessionRepository {
  revokedForUser: string[] = [];
  async create(_input: CreateSessionInput): Promise<SessionRow> {
    throw new Error('not used in these tests');
  }
  async findByTokenHash() {
    return null;
  }
  async touch() {}
  async revoke() {}
  async revokeAllForUser(userId: string): Promise<void> {
    this.revokedForUser.push(userId);
  }
}

class FakeAuditLog implements AuditLogRepository {
  events: AuditEvent[] = [];
  async write(_scope: BusinessScope, event: AuditEvent): Promise<void> {
    this.events.push(event);
  }
  async list(): Promise<never[]> {
    return [];
  }
}

let admins: FakeAdminRepository;
let roles: FakeRoleRepository;
let sessions: FakeSessionRepository;
let audit: FakeAuditLog;
let service: RbacService;

beforeEach(() => {
  admins = new FakeAdminRepository();
  roles = new FakeRoleRepository();
  sessions = new FakeSessionRepository();
  audit = new FakeAuditLog();
  service = new RbacService(
    admins,
    roles,
    {} as PasswordResetService, // not exercised by any test here
    sessions,
    audit,
  );

  roles.roles.set(
    'role-ops',
    roleRow({ id: 'role-ops', key: 'OPERATIONS', permissionKeys: ['orders:read'] }),
  );
  roles.roles.set(
    'role-super',
    roleRow({ id: 'role-super', key: 'SUPER_ADMIN', permissionKeys: ['roles:manage'] }),
  );
});

describe('RbacService.deactivate', () => {
  it('refuses to deactivate your own account', async () => {
    admins.rows.set(ACTOR_ADMIN_ID, row({ id: ACTOR_ADMIN_ID }));

    await expect(
      service.deactivate(BUSINESS_ID, {
        targetAdminUserId: ACTOR_ADMIN_ID,
        actorAdminUserId: ACTOR_ADMIN_ID,
        actorUserId: ACTOR_USER_ID,
        actorIsSuperAdmin: true,
      }),
    ).rejects.toMatchObject({ code: 'CANNOT_DEACTIVATE_SELF' });

    expect(admins.rows.get(ACTOR_ADMIN_ID)?.deletedAt).toBeNull();
    expect(sessions.revokedForUser).toHaveLength(0);
  });

  it('deactivates another account and revokes every session', async () => {
    const target = row({ id: 'target-1', userId: 'target-user-1' });
    admins.rows.set(target.id, target);

    const updated = await service.deactivate(BUSINESS_ID, {
      targetAdminUserId: target.id,
      actorAdminUserId: ACTOR_ADMIN_ID,
      actorUserId: ACTOR_USER_ID,
      actorIsSuperAdmin: true,
    });

    expect(updated.deletedAt).not.toBeNull();
    expect(sessions.revokedForUser).toContain('target-user-1');
    expect(audit.events.map((e) => e.action)).toContain('admin_user.deactivated');
  });

  it('refuses to deactivate the last active Super Admin', async () => {
    const target = row({ id: 'target-2', isSuperAdmin: true });
    admins.rows.set(target.id, target);
    admins.activeSuperAdminCount = 1;

    await expect(
      service.deactivate(BUSINESS_ID, {
        targetAdminUserId: target.id,
        actorAdminUserId: ACTOR_ADMIN_ID,
        actorUserId: ACTOR_USER_ID,
        actorIsSuperAdmin: true,
      }),
    ).rejects.toMatchObject({ code: 'LAST_SUPER_ADMIN' });
  });
});

describe('RbacService.reactivate', () => {
  it('reverses a deactivated account', async () => {
    const target = row({ id: 'target-3', deletedAt: now() });
    admins.rows.set(target.id, target);

    const updated = await service.reactivate(BUSINESS_ID, {
      targetAdminUserId: target.id,
      actorUserId: ACTOR_USER_ID,
      actorIsSuperAdmin: true,
    });

    expect(updated.deletedAt).toBeNull();
    expect(audit.events.map((e) => e.action)).toContain('admin_user.reactivated');
  });

  it('refuses to reactivate an account that is already active', async () => {
    const target = row({ id: 'target-4', deletedAt: null });
    admins.rows.set(target.id, target);

    await expect(
      service.reactivate(BUSINESS_ID, {
        targetAdminUserId: target.id,
        actorUserId: ACTOR_USER_ID,
        actorIsSuperAdmin: true,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('RbacService.setRoles', () => {
  it('refuses to let an admin change their own roles', async () => {
    admins.rows.set(ACTOR_ADMIN_ID, row({ id: ACTOR_ADMIN_ID }));

    await expect(
      service.setRoles(BUSINESS_ID, {
        targetAdminUserId: ACTOR_ADMIN_ID,
        roleIds: ['role-ops'],
        actorAdminUserId: ACTOR_ADMIN_ID,
        actorUserId: ACTOR_USER_ID,
        actorIsSuperAdmin: true,
      }),
    ).rejects.toMatchObject({ code: 'CANNOT_MODIFY_OWN_ROLES' });
  });

  it('revokes every session for the target once roles change', async () => {
    const target = row({ id: 'target-5', userId: 'target-user-5' });
    admins.rows.set(target.id, target);

    await service.setRoles(BUSINESS_ID, {
      targetAdminUserId: target.id,
      roleIds: ['role-ops'],
      actorAdminUserId: ACTOR_ADMIN_ID,
      actorUserId: ACTOR_USER_ID,
      actorIsSuperAdmin: true,
    });

    expect(sessions.revokedForUser).toContain('target-user-5');
  });

  it('refuses a non-Super-Admin actor granting roles:manage (privilege escalation)', async () => {
    const target = row({ id: 'target-6' });
    admins.rows.set(target.id, target);

    await expect(
      service.setRoles(BUSINESS_ID, {
        targetAdminUserId: target.id,
        roleIds: ['role-super'],
        actorAdminUserId: ACTOR_ADMIN_ID,
        actorUserId: ACTOR_USER_ID,
        actorIsSuperAdmin: false,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('refuses to demote the last active Super Admin', async () => {
    const target = row({ id: 'target-7', isSuperAdmin: true });
    admins.rows.set(target.id, target);
    admins.activeSuperAdminCount = 1;

    await expect(
      service.setRoles(BUSINESS_ID, {
        targetAdminUserId: target.id,
        roleIds: ['role-ops'],
        actorAdminUserId: ACTOR_ADMIN_ID,
        actorUserId: ACTOR_USER_ID,
        actorIsSuperAdmin: true,
      }),
    ).rejects.toMatchObject({ code: 'LAST_SUPER_ADMIN' });
  });
});

describe('RbacService target-authorization scoping (Stage E)', () => {
  it('refuses a non-Super-Admin resetting a Super Admin’s password', async () => {
    const target = row({ id: 'super-target', isSuperAdmin: true });
    admins.rows.set(target.id, target);
    const svc = new RbacService(
      admins,
      roles,
      { issueToken: async () => 'token' } as unknown as PasswordResetService,
      sessions,
      audit,
    );

    await expect(
      svc.resetAdminPassword(BUSINESS_ID, {
        targetAdminUserId: target.id,
        actorUserId: ACTOR_USER_ID,
        actorIsSuperAdmin: false,
      }),
    ).rejects.toMatchObject({ code: 'CANNOT_MANAGE_SUPER_ADMIN' });
  });

  it('allows a Super Admin resetting another Super Admin’s password', async () => {
    const target = row({ id: 'super-target-2', isSuperAdmin: true });
    admins.rows.set(target.id, target);
    const svc = new RbacService(
      admins,
      roles,
      { issueToken: async () => 'token' } as unknown as PasswordResetService,
      sessions,
      audit,
    );

    await expect(
      svc.resetAdminPassword(BUSINESS_ID, {
        targetAdminUserId: target.id,
        actorUserId: ACTOR_USER_ID,
        actorIsSuperAdmin: true,
      }),
    ).resolves.toMatchObject({ passwordResetLink: 'token' });
  });

  it('refuses a non-Super-Admin deactivating a Super Admin', async () => {
    const target = row({ id: 'super-target-3', isSuperAdmin: true });
    admins.rows.set(target.id, target);
    admins.activeSuperAdminCount = 5;

    await expect(
      service.deactivate(BUSINESS_ID, {
        targetAdminUserId: target.id,
        actorAdminUserId: ACTOR_ADMIN_ID,
        actorUserId: ACTOR_USER_ID,
        actorIsSuperAdmin: false,
      }),
    ).rejects.toMatchObject({ code: 'CANNOT_MANAGE_SUPER_ADMIN' });
  });

  it('refuses a non-Super-Admin updating a Super Admin’s details', async () => {
    const target = row({ id: 'super-target-4', isSuperAdmin: true });
    admins.rows.set(target.id, target);

    await expect(
      service.updateDetails(BUSINESS_ID, {
        targetAdminUserId: target.id,
        fullName: 'New Name',
        actorUserId: ACTOR_USER_ID,
        actorIsSuperAdmin: false,
      }),
    ).rejects.toMatchObject({ code: 'CANNOT_MANAGE_SUPER_ADMIN' });
  });

  it('does not restrict acting on a non-Super-Admin target', async () => {
    const target = row({ id: 'plain-target', isSuperAdmin: false });
    admins.rows.set(target.id, target);
    const svc = new RbacService(
      admins,
      roles,
      { issueToken: async () => 'token' } as unknown as PasswordResetService,
      sessions,
      audit,
    );

    await expect(
      svc.resetAdminPassword(BUSINESS_ID, {
        targetAdminUserId: target.id,
        actorUserId: ACTOR_USER_ID,
        actorIsSuperAdmin: false,
      }),
    ).resolves.toMatchObject({ passwordResetLink: 'token' });
  });
});

describe('RbacService.updateDetails', () => {
  it('updates name/designation/department without touching roles', async () => {
    const target = row({ id: 'target-8', roleKeys: ['OPERATIONS'] });
    admins.rows.set(target.id, target);

    const updated = await service.updateDetails(BUSINESS_ID, {
      targetAdminUserId: target.id,
      fullName: 'New Name',
      designation: 'Ops Lead',
      department: 'Operations',
      actorUserId: ACTOR_USER_ID,
      actorIsSuperAdmin: true,
    });

    expect(updated.fullName).toBe('New Name');
    expect(updated.designation).toBe('Ops Lead');
    expect(updated.department).toBe('Operations');
    expect(updated.roleKeys).toEqual(['OPERATIONS']);
    expect(admins.setRolesCalls).toHaveLength(0);
    expect(sessions.revokedForUser).toHaveLength(0);
    expect(audit.events.map((e) => e.action)).toContain('admin_user.updated');
  });

  it('404s for a nonexistent admin', async () => {
    await expect(
      service.updateDetails(BUSINESS_ID, {
        targetAdminUserId: 'does-not-exist',
        fullName: 'X',
        actorUserId: ACTOR_USER_ID,
        actorIsSuperAdmin: true,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('RbacService.inviteAdmin (Stage C: email-free login ID accounts)', () => {
  function serviceWithWorkingPasswordReset(): RbacService {
    return new RbacService(
      admins,
      roles,
      {
        issueToken: async () => 'https://admin.example.test/set-password?token=raw',
      } as unknown as PasswordResetService,
      sessions,
      audit,
    );
  }

  it('rejects an invite with neither email nor loginId', async () => {
    await expect(
      serviceWithWorkingPasswordReset().inviteAdmin(BUSINESS_ID, {
        fullName: 'No Identifier',
        roleIds: ['role-ops'],
        invitedByUserId: ACTOR_USER_ID,
        invitedByIsSuperAdmin: false,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(admins.invitedWith).toHaveLength(0);
  });

  it('creates an email-free account from loginId alone', async () => {
    const { admin, passwordResetLink } = await serviceWithWorkingPasswordReset().inviteAdmin(
      BUSINESS_ID,
      {
        loginId: 'rider.raj',
        fullName: 'Rider Raj',
        roleIds: ['role-ops'],
        invitedByUserId: ACTOR_USER_ID,
        invitedByIsSuperAdmin: false,
      },
    );

    expect(admin.email).toBeNull();
    expect(admin.loginId).toBe('rider.raj');
    expect(passwordResetLink).toContain('token=');
    expect(audit.events.map((e) => e.action)).toContain('admin_user.invited');
  });

  it('maps a duplicate loginId to LOGIN_ID_TAKEN, not ADMIN_ALREADY_INVITED', async () => {
    admins.rows.set('existing', row({ id: 'existing', email: null, loginId: 'rider.raj' }));

    await expect(
      serviceWithWorkingPasswordReset().inviteAdmin(BUSINESS_ID, {
        loginId: 'rider.raj',
        fullName: 'Another Rider',
        roleIds: ['role-ops'],
        invitedByUserId: ACTOR_USER_ID,
        invitedByIsSuperAdmin: false,
      }),
    ).rejects.toMatchObject({ code: 'LOGIN_ID_TAKEN' });
  });
});
