import { newId, type BusinessScope, type RoleRepository, type RoleRow } from '@healthy-aahar/core';
import type { PrismaClient } from '@healthy-aahar/db';

const ROLE_INCLUDE = { permissions: { include: { permission: { select: { key: true } } } } } as const;

function toRoleRow(role: {
  id: string;
  businessId: string;
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: { permission: { key: string } }[];
}): RoleRow {
  return {
    id: role.id,
    businessId: role.businessId,
    key: role.key,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    permissionKeys: role.permissions.map((p) => p.permission.key),
  };
}

export class PrismaRoleRepository implements RoleRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list(scope: BusinessScope): Promise<RoleRow[]> {
    const roles = await this.prisma.role.findMany({
      where: { businessId: scope },
      include: ROLE_INCLUDE,
      orderBy: { createdAt: 'asc' },
    });
    return roles.map(toRoleRow);
  }

  async findById(scope: BusinessScope, id: string): Promise<RoleRow | null> {
    const role = await this.prisma.role.findFirst({ where: { id, businessId: scope }, include: ROLE_INCLUDE });
    return role ? toRoleRow(role) : null;
  }

  async findByKey(scope: BusinessScope, key: string): Promise<RoleRow | null> {
    const role = await this.prisma.role.findFirst({ where: { key, businessId: scope }, include: ROLE_INCLUDE });
    return role ? toRoleRow(role) : null;
  }

  async create(
    scope: BusinessScope,
    input: { key: string; name: string; description?: string; permissionKeys: string[] },
  ): Promise<RoleRow> {
    const permissions = await this.prisma.permission.findMany({
      where: { key: { in: input.permissionKeys } },
      select: { id: true },
    });

    const created = await this.prisma.role.create({
      data: {
        id: newId(),
        businessId: scope,
        key: input.key,
        name: input.name,
        description: input.description ?? null,
        isSystem: false,
        permissions: {
          create: permissions.map((p) => ({ permissionId: p.id })),
        },
      },
      include: ROLE_INCLUDE,
    });

    return toRoleRow(created);
  }

  async updatePermissions(scope: BusinessScope, id: string, permissionKeys: string[]): Promise<RoleRow> {
    const permissions = await this.prisma.permission.findMany({
      where: { key: { in: permissionKeys } },
      select: { id: true },
    });

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId: id } });
      if (permissions.length > 0) {
        await tx.rolePermission.createMany({
          data: permissions.map((p) => ({ roleId: id, permissionId: p.id })),
        });
      }
      return tx.role.findUniqueOrThrow({ where: { id }, include: ROLE_INCLUDE });
    });

    void scope;
    return toRoleRow(updated);
  }

  async listAllPermissionKeys(): Promise<string[]> {
    const rows = await this.prisma.permission.findMany({ select: { key: true } });
    return rows.map((r) => r.key);
  }
}
