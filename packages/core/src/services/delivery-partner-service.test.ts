import { beforeEach, describe, expect, it } from 'vitest';

import { businessScope } from '../domain/business-scope.js';
import type { BusinessScope } from '../domain/business-scope.js';
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
  CreateDeliveryPartnerProfileInput,
  DeliveryPartnerListFilter,
  DeliveryPartnerRepository,
  DeliveryPartnerRow,
} from '../ports/delivery-partner-repository.js';
import type {
  CreateSessionInput,
  SessionRepository,
  SessionRow,
} from '../ports/session-repository.js';
import type { PasswordResetService } from './password-reset-service.js';
import { RbacService } from './rbac-service.js';
import { DeliveryPartnerService } from './delivery-partner-service.js';

const BUSINESS_ID = businessScope('0193aaaa-0000-7000-8000-00000000000b');
const ACTOR_USER_ID = '0193bbbb-0000-7000-8000-000000000001';
const ACTOR_ADMIN_ID = '0193bbbb-0000-7000-8000-000000000002';
const DELIVERY_ROLE_ID = 'role-delivery-partner';

class FakeAdminRepository implements AdminRepository {
  rows = new Map<string, AdminUserRow>();
  nextId = 1;

  async findByUserId(): Promise<null> {
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
  async invite(_scope: BusinessScope, input: InviteAdminInput): Promise<InviteAdminResult> {
    const id = `admin-${this.nextId++}`;
    const row: AdminUserRow = {
      id,
      businessId: BUSINESS_ID,
      userId: `user-${id}`,
      email: input.email ?? null,
      loginId: input.loginId ?? null,
      employeeCode: input.employeeCode ?? null,
      fullName: input.fullName,
      designation: input.designation ?? null,
      department: input.department ?? null,
      isSuperAdmin: false,
      invitedBy: input.invitedByUserId,
      invitationAcceptedAt: null,
      deletedAt: null,
      roleKeys: ['DELIVERY_PARTNER'],
      lastPasswordChangeAt: null,
      mustChangePassword: false,
    };
    this.rows.set(id, row);
    return { ok: true, admin: row };
  }
  async countActiveSuperAdmins(): Promise<number> {
    return 1;
  }
  async setRoles(): Promise<never> {
    throw new Error('not used in these tests');
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
  async update(_scope: BusinessScope, adminUserId: string, input: UpdateAdminDetailsInput) {
    const existing = this.rows.get(adminUserId);
    if (!existing) throw new Error('not found');
    const updated = { ...existing, ...input };
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
  async findByKey(_scope: BusinessScope, key: string): Promise<RoleRow | null> {
    return [...this.roles.values()].find((r) => r.key === key) ?? null;
  }
  async create(): Promise<never> {
    throw new Error('not used in these tests');
  }
  async updatePermissions(): Promise<never> {
    throw new Error('not used in these tests');
  }
  async listAllPermissionKeys(): Promise<string[]> {
    return ['deliveries:fulfil'];
  }
}

class FakeSessionRepository implements SessionRepository {
  async create(_input: CreateSessionInput): Promise<SessionRow> {
    throw new Error('not used in these tests');
  }
  async findByTokenHash(): Promise<null> {
    return null;
  }
  async revoke(): Promise<void> {}
  async revokeAllForUser(): Promise<void> {}
  async touch(): Promise<void> {}
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

/**
 * Mirrors the real Prisma repository's AdminUser join: `fullName`/`email`/
 * `deactivated` live on the AdminUser, not the profile row, so this fake
 * reads them from the same `FakeAdminRepository` the test's `RbacService`
 * writes to, rather than hardcoding a name `DeliveryPartnerService.create`
 * never actually passes to `createProfile` (whose input is vehicle fields
 * only, by design — see `CreateDeliveryPartnerProfileInput`).
 */
class FakeDeliveryPartnerRepository implements DeliveryPartnerRepository {
  profiles = new Map<string, { vehicleType: string | null; vehicleNumber: string | null }>();

  constructor(private readonly admins: FakeAdminRepository) {}

  private toRow(adminUserId: string): DeliveryPartnerRow | null {
    const profile = this.profiles.get(adminUserId);
    const admin = this.admins.rows.get(adminUserId);
    if (!profile || !admin) return null;
    return {
      adminUserId,
      fullName: admin.fullName,
      email: admin.email,
      loginId: admin.loginId,
      // AdminUserRow (the core port type) doesn't carry employee_code — the
      // real Prisma repository reads it via its own dedicated include,
      // bypassing this port entirely; not worth replicating in a fake.
      employeeCode: null,
      dutyStatus: 'OFF_DUTY',
      dutyChangedAt: null,
      vehicleType: profile.vehicleType,
      vehicleNumber: profile.vehicleNumber,
      deactivated: admin.deletedAt !== null,
      activeDeliveryCount: 0,
    };
  }

  async list(_scope: BusinessScope, _filter: DeliveryPartnerListFilter) {
    return [...this.profiles.keys()]
      .map((id) => this.toRow(id))
      .filter((r): r is DeliveryPartnerRow => r !== null);
  }
  async findByAdminUserId(_scope: BusinessScope, adminUserId: string) {
    return this.toRow(adminUserId);
  }
  async createProfile(
    _scope: BusinessScope,
    adminUserId: string,
    input: CreateDeliveryPartnerProfileInput,
  ) {
    this.profiles.set(adminUserId, {
      vehicleType: input.vehicleType ?? null,
      vehicleNumber: input.vehicleNumber ?? null,
    });
    const row = this.toRow(adminUserId);
    if (!row) throw new Error('admin user must exist before a profile is created');
    return row;
  }
  async setDutyStatus(): Promise<never> {
    throw new Error('not used in these tests');
  }
}

describe('DeliveryPartnerService', () => {
  let admins: FakeAdminRepository;
  let roles: FakeRoleRepository;
  let sessions: FakeSessionRepository;
  let audit: FakeAuditLog;
  let partners: FakeDeliveryPartnerRepository;
  let rbac: RbacService;
  let service: DeliveryPartnerService;

  beforeEach(() => {
    admins = new FakeAdminRepository();
    roles = new FakeRoleRepository();
    sessions = new FakeSessionRepository();
    audit = new FakeAuditLog();
    partners = new FakeDeliveryPartnerRepository(admins);

    roles.roles.set(DELIVERY_ROLE_ID, {
      id: DELIVERY_ROLE_ID,
      businessId: BUSINESS_ID,
      key: 'DELIVERY_PARTNER',
      name: 'Delivery Partner',
      description: null,
      isSystem: true,
      permissionKeys: ['deliveries:fulfil'],
    });

    const fakePasswordReset = {
      issueToken: async () => 'raw-token-123',
    } as unknown as PasswordResetService;

    rbac = new RbacService(admins, roles, fakePasswordReset, sessions, audit);
    service = new DeliveryPartnerService({ partners, roles, rbac, audit });
  });

  it('creates a delivery partner: invites the AdminUser and creates the profile', async () => {
    const { partner, passwordResetLink } = await service.create(BUSINESS_ID, {
      email: 'rider@example.test',
      fullName: 'Rider One',
      actorUserId: ACTOR_USER_ID,
    });

    expect(partner.fullName).toBe('Rider One');
    expect(partner.dutyStatus).toBe('OFF_DUTY');
    expect(passwordResetLink).toBe('raw-token-123');
    expect(audit.events.map((e) => e.action)).toContain('delivery_partner.created');
  });

  it('refuses to create a partner when the DELIVERY_PARTNER role is not configured', async () => {
    roles.roles.clear();

    await expect(
      service.create(BUSINESS_ID, {
        email: 'rider@example.test',
        fullName: 'Rider One',
        actorUserId: ACTOR_USER_ID,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('suspending a partner reuses RbacService.deactivate (session revocation included)', async () => {
    const { partner } = await service.create(BUSINESS_ID, {
      email: 'rider@example.test',
      fullName: 'Rider One',
      actorUserId: ACTOR_USER_ID,
    });

    const suspended = await service.suspend(BUSINESS_ID, {
      adminUserId: partner.adminUserId,
      actorAdminUserId: ACTOR_ADMIN_ID,
      actorUserId: ACTOR_USER_ID,
    });

    expect(suspended.deactivated).toBe(true);
    expect(audit.events.map((e) => e.action)).toContain('delivery_partner.suspended');
  });

  it('reactivating reverses suspension', async () => {
    const { partner } = await service.create(BUSINESS_ID, {
      email: 'rider@example.test',
      fullName: 'Rider One',
      actorUserId: ACTOR_USER_ID,
    });
    await service.suspend(BUSINESS_ID, {
      adminUserId: partner.adminUserId,
      actorAdminUserId: ACTOR_ADMIN_ID,
      actorUserId: ACTOR_USER_ID,
    });

    const reactivated = await service.reactivate(BUSINESS_ID, {
      adminUserId: partner.adminUserId,
      actorUserId: ACTOR_USER_ID,
    });

    expect(reactivated.deactivated).toBe(false);
  });

  it('404s for a nonexistent partner', async () => {
    await expect(service.get(BUSINESS_ID, 'does-not-exist')).rejects.toMatchObject({
      code: 'PARTNER_NOT_FOUND',
    });
  });
});
