import {
  newId,
  now,
  type AdminRepository,
  type AdminUserRow,
  type BusinessScope,
  type EffectivePermissions,
  type InviteAdminInput,
} from '@healthy-aahar/core';
import type { UserRow } from '@healthy-aahar/core';
import type { PrismaClient } from '@healthy-aahar/db';

/**
 * Prisma implementation of admin identity + role assignment (docs/07 §3,
 * docs/08 §5.2). `is_super_admin` is derived from — and kept in sync with —
 * holding the `SUPER_ADMIN` role, so there is exactly one place that grants
 * it (role assignment), not two mechanisms that can drift apart.
 */

function toAdminUserRow(admin: {
  id: string;
  businessId: string;
  userId: string;
  fullName: string;
  designation: string | null;
  isSuperAdmin: boolean;
  invitedBy: string | null;
  invitationAcceptedAt: Date | null;
  deletedAt: Date | null;
  user: { firebaseUid: string; email: string | null };
  roles: { role: { key: string } }[];
}): AdminUserRow {
  return {
    id: admin.id,
    businessId: admin.businessId,
    userId: admin.userId,
    firebaseUid: admin.user.firebaseUid,
    email: admin.user.email,
    fullName: admin.fullName,
    designation: admin.designation,
    isSuperAdmin: admin.isSuperAdmin,
    invitedBy: admin.invitedBy,
    invitationAcceptedAt: admin.invitationAcceptedAt,
    deletedAt: admin.deletedAt,
    roleKeys: admin.roles.map((r) => r.role.key),
  };
}

const ADMIN_INCLUDE = {
  user: { select: { firebaseUid: true, email: true } },
  roles: { include: { role: { select: { key: true } } } },
} as const;

export class PrismaAdminRepository implements AdminRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByFirebaseUid(
    scope: BusinessScope,
    firebaseUid: string,
  ): Promise<{ user: UserRow; admin: AdminUserRow } | null> {
    const user = await this.prisma.user.findUnique({
      where: { firebaseUid_userType: { firebaseUid, userType: 'ADMIN' } },
    });
    if (!user) return null;

    const admin = await this.prisma.adminUser.findFirst({
      where: { userId: user.id, businessId: scope },
      include: ADMIN_INCLUDE,
    });
    if (!admin) return null;

    return {
      user: {
        id: user.id,
        firebaseUid: user.firebaseUid,
        userType: 'ADMIN',
        email: user.email,
        phone: user.phone,
        emailVerified: user.emailVerified,
        phoneVerified: user.phoneVerified,
        status: user.status,
        lastLoginAt: user.lastLoginAt,
      },
      admin: toAdminUserRow(admin),
    };
  }

  async findById(scope: BusinessScope, adminUserId: string): Promise<AdminUserRow | null> {
    const admin = await this.prisma.adminUser.findFirst({
      where: { id: adminUserId, businessId: scope },
      include: ADMIN_INCLUDE,
    });
    return admin ? toAdminUserRow(admin) : null;
  }

  async list(scope: BusinessScope): Promise<AdminUserRow[]> {
    const admins = await this.prisma.adminUser.findMany({
      where: { businessId: scope },
      include: ADMIN_INCLUDE,
      orderBy: { createdAt: 'asc' },
    });
    return admins.map(toAdminUserRow);
  }

  async loadEffectivePermissions(scope: BusinessScope, adminUserId: string): Promise<EffectivePermissions> {
    const admin = await this.prisma.adminUser.findFirst({
      where: { id: adminUserId, businessId: scope },
      select: {
        isSuperAdmin: true,
        roles: {
          select: {
            role: { select: { permissions: { select: { permission: { select: { key: true } } } } } },
          },
        },
      },
    });

    if (!admin) return { permissions: [], isSuperAdmin: false };

    const keys = new Set<string>();
    for (const { role } of admin.roles) {
      for (const rp of role.permissions) keys.add(rp.permission.key);
    }

    return { permissions: [...keys], isSuperAdmin: admin.isSuperAdmin };
  }

  async invite(scope: BusinessScope, input: InviteAdminInput): Promise<AdminUserRow> {
    const roles = await this.prisma.role.findMany({
      where: { id: { in: input.roleIds }, businessId: scope },
      select: { id: true, key: true },
    });
    const isSuperAdmin = roles.some((r) => r.key === 'SUPER_ADMIN');

    const created = await this.prisma.$transaction(async (tx) => {
      const userId = newId();
      const adminUserId = newId();

      await tx.user.create({
        data: {
          id: userId,
          firebaseUid: input.firebaseUid,
          userType: 'ADMIN',
          email: input.email,
          emailVerified: false,
          status: 'ACTIVE',
        },
      });

      await tx.adminUser.create({
        data: {
          id: adminUserId,
          businessId: scope,
          userId,
          fullName: input.fullName,
          designation: input.designation ?? null,
          isSuperAdmin,
          invitedBy: input.invitedByUserId,
        },
      });

      if (roles.length > 0) {
        await tx.adminUserRole.createMany({
          data: roles.map((r) => ({ adminUserId, roleId: r.id, grantedBy: input.invitedByUserId })),
        });
      }

      return tx.adminUser.findUniqueOrThrow({ where: { id: adminUserId }, include: ADMIN_INCLUDE });
    });

    return toAdminUserRow(created);
  }

  async countActiveSuperAdmins(scope: BusinessScope): Promise<number> {
    return this.prisma.adminUser.count({
      where: {
        businessId: scope,
        isSuperAdmin: true,
        deletedAt: null,
        user: { status: 'ACTIVE' },
      },
    });
  }

  async setRoles(scope: BusinessScope, adminUserId: string, roleIds: string[], grantedBy: string): Promise<AdminUserRow> {
    const roles = await this.prisma.role.findMany({
      where: { id: { in: roleIds }, businessId: scope },
      select: { id: true, key: true },
    });
    const isSuperAdmin = roles.some((r) => r.key === 'SUPER_ADMIN');

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.adminUserRole.deleteMany({ where: { adminUserId } });
      if (roles.length > 0) {
        await tx.adminUserRole.createMany({
          data: roles.map((r) => ({ adminUserId, roleId: r.id, grantedBy })),
        });
      }
      await tx.adminUser.update({ where: { id: adminUserId }, data: { isSuperAdmin } });
      return tx.adminUser.findUniqueOrThrow({ where: { id: adminUserId }, include: ADMIN_INCLUDE });
    });

    void scope;
    return toAdminUserRow(updated);
  }

  async deactivate(scope: BusinessScope, adminUserId: string): Promise<AdminUserRow> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const admin = await tx.adminUser.update({
        where: { id: adminUserId },
        data: { deletedAt: now() },
        include: ADMIN_INCLUDE,
      });
      await tx.user.update({ where: { id: admin.userId }, data: { status: 'DEACTIVATED' } });
      return admin;
    });

    void scope;
    return toAdminUserRow(updated);
  }
}
