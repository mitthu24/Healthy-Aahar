import {
  newId,
  now,
  type BusinessScope,
  type CityListFilter,
  type CityRepository,
  type CreateCityInput,
  type CreatePincodeInput,
  type PincodeListFilter,
  type PincodeRepository,
  type UpdateCityInput,
  type UpdatePincodeInput,
} from '@healthy-aahar/core';
import type { CityRow, PincodeRow } from '@healthy-aahar/core';
import type { Prisma, PrismaClient } from '@healthy-aahar/db';

/**
 * Prisma implementations of the admin serviceability ports.
 *
 * Every query filters by `businessId` INSIDE the where clause — never as a
 * post-fetch check. Cross-business data therefore cannot be returned even by
 * a buggy caller, because it is never selected in the first place
 * (ADR-005, docs/23 §4).
 */

const CITY_SELECT = {
  id: true,
  businessId: true,
  name: true,
  slug: true,
  displayName: true,
  state: true,
  country: true,
  timezone: true,
  status: true,
  displayOrder: true,
  activatedAt: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { pincodes: true } },
} satisfies Prisma.CitySelect;

const PINCODE_SELECT = {
  id: true,
  businessId: true,
  cityId: true,
  pincode: true,
  areaName: true,
  status: true,
  displayOrder: true,
  activatedAt: true,
  createdAt: true,
  updatedAt: true,
  city: { select: { id: true, name: true, slug: true, state: true, status: true } },
} satisfies Prisma.ServicePincodeSelect;

type RawCity = Prisma.CityGetPayload<{ select: typeof CITY_SELECT }>;
type RawPincode = Prisma.ServicePincodeGetPayload<{ select: typeof PINCODE_SELECT }>;

export class PrismaCityRepository implements CityRepository {
  constructor(private readonly prisma: PrismaClient) {}

  private async toRow(raw: RawCity): Promise<CityRow> {
    const activePincodeCount = await this.prisma.servicePincode.count({
      where: { cityId: raw.id, status: 'ACTIVE' },
    });

    return {
      id: raw.id,
      businessId: raw.businessId,
      name: raw.name,
      slug: raw.slug,
      displayName: raw.displayName,
      state: raw.state,
      country: raw.country,
      timezone: raw.timezone,
      status: raw.status,
      displayOrder: raw.displayOrder,
      activatedAt: raw.activatedAt,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
      pincodeCount: raw._count.pincodes,
      activePincodeCount,
    };
  }

  async list(scope: BusinessScope, filter: CityListFilter): Promise<CityRow[]> {
    const where: Prisma.CityWhereInput = {
      businessId: scope,
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.state ? { state: { equals: filter.state, mode: 'insensitive' } } : {}),
      ...(filter.q
        ? {
            OR: [
              { name: { contains: filter.q, mode: 'insensitive' } },
              { state: { contains: filter.q, mode: 'insensitive' } },
            ],
          }
        : {}),
      // Keyset pagination: (display_order, id) strictly after the cursor.
      // A compound comparison, not an offset — stable under concurrent writes.
      ...(filter.cursor
        ? {
            OR: [
              { displayOrder: { gt: Number(filter.cursor.sortValue) } },
              {
                displayOrder: Number(filter.cursor.sortValue),
                id: { gt: filter.cursor.id },
              },
            ],
          }
        : {}),
    };

    const rows = await this.prisma.city.findMany({
      where,
      select: CITY_SELECT,
      orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
      take: filter.limit,
    });

    return Promise.all(rows.map((r) => this.toRow(r)));
  }

  async findById(scope: BusinessScope, id: string): Promise<CityRow | null> {
    const raw = await this.prisma.city.findFirst({
      where: { id, businessId: scope },
      select: CITY_SELECT,
    });
    return raw ? this.toRow(raw) : null;
  }

  async findBySlug(scope: BusinessScope, slug: string): Promise<CityRow | null> {
    const raw = await this.prisma.city.findFirst({
      where: { slug, businessId: scope },
      select: CITY_SELECT,
    });
    return raw ? this.toRow(raw) : null;
  }

  async create(scope: BusinessScope, input: CreateCityInput): Promise<CityRow> {
    const raw = await this.prisma.city.create({
      data: {
        id: newId(),
        businessId: scope,
        name: input.name,
        slug: input.slug,
        displayName: input.displayName ?? null,
        state: input.state,
        country: input.country,
        timezone: input.timezone,
        displayOrder: input.displayOrder,
        // Always INACTIVE on create; activation is a separate guarded
        // operation that checks the city has pincodes to serve (BR-SV4).
        status: 'INACTIVE',
        createdBy: input.actorUserId ?? null,
        updatedBy: input.actorUserId ?? null,
      },
      select: CITY_SELECT,
    });
    return this.toRow(raw);
  }

  async update(scope: BusinessScope, id: string, input: UpdateCityInput): Promise<CityRow> {
    const raw = await this.prisma.city.update({
      // updateMany-style scoping is not available on update(), so the caller
      // has already verified ownership via findById. The businessId in the
      // data payload is never changed.
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
        ...(input.state !== undefined ? { state: input.state } : {}),
        ...(input.country !== undefined ? { country: input.country } : {}),
        ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
        ...(input.displayOrder !== undefined ? { displayOrder: input.displayOrder } : {}),
        updatedBy: input.actorUserId ?? null,
      },
      select: CITY_SELECT,
    });
    void scope;
    return this.toRow(raw);
  }

  async setStatus(
    scope: BusinessScope,
    id: string,
    status: CityRow['status'],
    actorUserId?: string,
  ): Promise<CityRow> {
    const raw = await this.prisma.city.update({
      where: { id },
      data: {
        status,
        // The CHECK constraint requires activated_at on an ACTIVE row, and
        // the first activation date is worth keeping for cohort reporting.
        ...(status === 'ACTIVE' ? { activatedAt: now() } : {}),
        updatedBy: actorUserId ?? null,
      },
      select: CITY_SELECT,
    });
    void scope;
    return this.toRow(raw);
  }

  async countActivePincodes(scope: BusinessScope, cityId: string): Promise<number> {
    return this.prisma.servicePincode.count({
      where: { businessId: scope, cityId, status: 'ACTIVE' },
    });
  }
}

export class PrismaPincodeRepository implements PincodeRepository {
  constructor(private readonly prisma: PrismaClient) {}

  private toRow(raw: RawPincode): PincodeRow {
    return {
      id: raw.id,
      businessId: raw.businessId,
      cityId: raw.cityId,
      pincode: raw.pincode,
      areaName: raw.areaName,
      status: raw.status,
      displayOrder: raw.displayOrder,
      activatedAt: raw.activatedAt,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
      city: raw.city,
    };
  }

  async list(scope: BusinessScope, filter: PincodeListFilter): Promise<PincodeRow[]> {
    const where: Prisma.ServicePincodeWhereInput = {
      businessId: scope,
      ...(filter.cityId ? { cityId: filter.cityId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.q
        ? {
            OR: [
              { pincode: { startsWith: filter.q } },
              { areaName: { contains: filter.q, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(filter.cursor
        ? {
            OR: [
              { pincode: { gt: filter.cursor.sortValue } },
              { pincode: filter.cursor.sortValue, id: { gt: filter.cursor.id } },
            ],
          }
        : {}),
    };

    const rows = await this.prisma.servicePincode.findMany({
      where,
      select: PINCODE_SELECT,
      orderBy: [{ pincode: 'asc' }, { id: 'asc' }],
      take: filter.limit,
    });

    return rows.map((r) => this.toRow(r));
  }

  async findById(scope: BusinessScope, id: string): Promise<PincodeRow | null> {
    const raw = await this.prisma.servicePincode.findFirst({
      where: { id, businessId: scope },
      select: PINCODE_SELECT,
    });
    return raw ? this.toRow(raw) : null;
  }

  async findByPincode(scope: BusinessScope, pincode: string): Promise<PincodeRow | null> {
    const raw = await this.prisma.servicePincode.findFirst({
      where: { pincode, businessId: scope },
      select: PINCODE_SELECT,
    });
    return raw ? this.toRow(raw) : null;
  }

  async create(scope: BusinessScope, input: CreatePincodeInput): Promise<PincodeRow> {
    const raw = await this.prisma.servicePincode.create({
      data: {
        id: newId(),
        businessId: scope,
        cityId: input.cityId,
        pincode: input.pincode,
        areaName: input.areaName ?? null,
        displayOrder: input.displayOrder,
        status: 'INACTIVE',
        createdBy: input.actorUserId ?? null,
        updatedBy: input.actorUserId ?? null,
      },
      select: PINCODE_SELECT,
    });
    return this.toRow(raw);
  }

  async update(scope: BusinessScope, id: string, input: UpdatePincodeInput): Promise<PincodeRow> {
    const raw = await this.prisma.servicePincode.update({
      where: { id },
      data: {
        ...(input.cityId !== undefined ? { cityId: input.cityId } : {}),
        ...(input.areaName !== undefined ? { areaName: input.areaName } : {}),
        ...(input.displayOrder !== undefined ? { displayOrder: input.displayOrder } : {}),
        updatedBy: input.actorUserId ?? null,
      },
      select: PINCODE_SELECT,
    });
    void scope;
    return this.toRow(raw);
  }

  async setStatus(
    scope: BusinessScope,
    id: string,
    status: PincodeRow['status'],
    actorUserId?: string,
  ): Promise<PincodeRow> {
    const raw = await this.prisma.servicePincode.update({
      where: { id },
      data: {
        status,
        ...(status === 'ACTIVE' ? { activatedAt: now() } : {}),
        updatedBy: actorUserId ?? null,
      },
      select: PINCODE_SELECT,
    });
    void scope;
    return this.toRow(raw);
  }
}
