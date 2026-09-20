import type { CityRecord, PincodeRecord, ServiceabilityRepository } from '@healthy-aahar/core';
import type { PrismaClient } from '@healthy-aahar/db';

/**
 * Prisma implementation of the serviceability port.
 *
 * This is the only file that knows serviceability is stored in PostgreSQL.
 * The rules in packages/core are tested against an in-memory fake and never
 * see a query (docs/02-SYSTEM-ARCHITECTURE.md §4).
 *
 * Every query is scoped by `businessId` in the WHERE clause — not filtered
 * afterwards — so a second business can never leak into a first business's
 * serviceability (ADR-005).
 */
export class PrismaServiceabilityRepository implements ServiceabilityRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findPincode(businessId: string, pincode: string): Promise<PincodeRecord | null> {
    const row = await this.prisma.servicePincode.findUnique({
      where: { businessId_pincode: { businessId, pincode } },
      select: {
        id: true,
        pincode: true,
        areaName: true,
        status: true,
        city: {
          select: { id: true, name: true, slug: true, state: true, status: true },
        },
      },
    });

    if (!row) return null;

    return {
      id: row.id,
      pincode: row.pincode,
      areaName: row.areaName,
      status: row.status,
      city: {
        id: row.city.id,
        name: row.city.name,
        slug: row.city.slug,
        state: row.city.state,
        status: row.city.status,
      },
    };
  }

  async listCities(
    businessId: string,
    filter?: { status?: CityRecord['status']; state?: string },
  ): Promise<CityRecord[]> {
    const rows = await this.prisma.city.findMany({
      where: {
        businessId,
        ...(filter?.status ? { status: filter.status } : {}),
        ...(filter?.state ? { state: filter.state } : {}),
      },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, slug: true, state: true, status: true },
    });

    return rows;
  }

  async listPincodesByCity(
    businessId: string,
    cityId: string,
    filter?: { status?: PincodeRecord['status'] },
  ): Promise<PincodeRecord[]> {
    const rows = await this.prisma.servicePincode.findMany({
      where: {
        businessId,
        cityId,
        ...(filter?.status ? { status: filter.status } : {}),
      },
      orderBy: [{ displayOrder: 'asc' }, { pincode: 'asc' }],
      select: {
        id: true,
        pincode: true,
        areaName: true,
        status: true,
        city: { select: { id: true, name: true, slug: true, state: true, status: true } },
      },
    });

    return rows.map((row) => ({
      id: row.id,
      pincode: row.pincode,
      areaName: row.areaName,
      status: row.status,
      city: row.city,
    }));
  }

  async countActivePincodes(businessId: string, cityId: string): Promise<number> {
    return this.prisma.servicePincode.count({
      where: { businessId, cityId, status: 'ACTIVE' },
    });
  }
}
