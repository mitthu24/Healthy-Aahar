import {
  newId,
  now,
  type BusinessScope,
  type SettingRepository,
  type UnitInput,
  type UnitRepository,
  type UnitRow,
  type UnitUpdateInput,
} from '@healthy-aahar/core';
import type { PrismaClient } from '@healthy-aahar/db';

function toUnitRow(row: {
  id: string;
  businessId: string;
  code: string;
  label: string;
  symbol: string;
  dimension: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}): UnitRow {
  return {
    id: row.id,
    businessId: row.businessId,
    code: row.code,
    label: row.label,
    symbol: row.symbol,
    dimension: row.dimension as UnitRow['dimension'],
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PrismaUnitRepository implements UnitRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list(scope: BusinessScope, filter?: { activeOnly?: boolean }): Promise<UnitRow[]> {
    const rows = await this.prisma.unit.findMany({
      where: { businessId: scope, ...(filter?.activeOnly ? { isActive: true } : {}) },
      orderBy: { code: 'asc' },
    });
    return rows.map(toUnitRow);
  }

  async findById(scope: BusinessScope, id: string): Promise<UnitRow | null> {
    const row = await this.prisma.unit.findFirst({ where: { id, businessId: scope } });
    return row ? toUnitRow(row) : null;
  }

  async findByCode(scope: BusinessScope, code: string): Promise<UnitRow | null> {
    const row = await this.prisma.unit.findFirst({ where: { code, businessId: scope } });
    return row ? toUnitRow(row) : null;
  }

  async create(scope: BusinessScope, input: UnitInput): Promise<UnitRow> {
    const created = await this.prisma.unit.create({
      data: {
        id: newId(),
        businessId: scope,
        code: input.code,
        label: input.label,
        symbol: input.symbol,
        dimension: input.dimension,
      },
    });
    return toUnitRow(created);
  }

  async update(scope: BusinessScope, id: string, input: UnitUpdateInput): Promise<UnitRow> {
    const updated = await this.prisma.unit.update({
      where: { id },
      data: {
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(input.symbol !== undefined ? { symbol: input.symbol } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        updatedAt: now(),
      },
    });
    // `where: { id }` alone isn't tenant-scoped at the query level — the
    // service layer always calls `findById(scope, id)` first (throwing
    // UNIT_NOT_FOUND for cross-tenant ids) before this ever runs, the same
    // "find scoped, then write by id" convention `AdminVariantRepository`
    // already uses elsewhere in this codebase.
    void scope;
    return toUnitRow(updated);
  }

  async countVariantReferences(scope: BusinessScope, code: string): Promise<number> {
    return this.prisma.productVariant.count({ where: { businessId: scope, unit: code } });
  }
}

export class PrismaSettingRepository implements SettingRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getValue(scope: BusinessScope, key: string): Promise<unknown | null> {
    const row = await this.prisma.setting.findUnique({
      where: { businessId_key: { businessId: scope, key } },
      select: { value: true },
    });
    return row ? row.value : null;
  }

  async setValue(
    scope: BusinessScope,
    key: string,
    value: unknown,
    updatedBy: string,
  ): Promise<void> {
    await this.prisma.setting.upsert({
      where: { businessId_key: { businessId: scope, key } },
      create: {
        id: newId(),
        businessId: scope,
        key,
        value: value as never,
        isPublic: false,
        updatedBy,
      },
      update: { value: value as never, updatedBy },
    });
  }
}
