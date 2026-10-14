import type {
  BusinessScope,
  CreateDeliveryPartnerProfileInput,
  DeliveryPartnerListFilter,
  DeliveryPartnerRepository,
  DeliveryPartnerRow,
  DutyStatus,
} from '@healthy-aahar/core';
import { newId, now } from '@healthy-aahar/core';
import type { Prisma, PrismaClient } from '@healthy-aahar/db';

const PROFILE_INCLUDE = {
  adminUser: {
    select: {
      id: true,
      fullName: true,
      employeeCode: true,
      deletedAt: true,
      user: { select: { email: true, loginId: true } },
    },
  },
} satisfies Prisma.DeliveryPartnerProfileInclude;

type RawProfile = Prisma.DeliveryPartnerProfileGetPayload<{ include: typeof PROFILE_INCLUDE }>;

function toRow(raw: RawProfile, activeDeliveryCount: number): DeliveryPartnerRow {
  return {
    adminUserId: raw.adminUserId,
    fullName: raw.adminUser.fullName,
    email: raw.adminUser.user.email,
    loginId: raw.adminUser.user.loginId,
    employeeCode: raw.adminUser.employeeCode,
    dutyStatus: raw.dutyStatus,
    dutyChangedAt: raw.dutyChangedAt,
    vehicleType: raw.vehicleType,
    vehicleNumber: raw.vehicleNumber,
    deactivated: raw.adminUser.deletedAt !== null,
    activeDeliveryCount,
  };
}

/** Prisma implementation of the delivery-partner profile (PHASE 06). */
export class PrismaDeliveryPartnerRepository implements DeliveryPartnerRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list(
    scope: BusinessScope,
    filter: DeliveryPartnerListFilter,
  ): Promise<DeliveryPartnerRow[]> {
    const q = filter.q?.trim();
    const profiles = await this.prisma.deliveryPartnerProfile.findMany({
      where: {
        businessId: scope,
        ...(filter.dutyStatus ? { dutyStatus: filter.dutyStatus } : {}),
        ...(q
          ? {
              adminUser: {
                OR: [
                  { fullName: { contains: q, mode: 'insensitive' } },
                  { user: { email: { contains: q, mode: 'insensitive' } } },
                  { user: { loginId: { contains: q, mode: 'insensitive' } } },
                ],
              },
            }
          : {}),
      },
      include: PROFILE_INCLUDE,
      orderBy: { createdAt: 'asc' },
    });

    if (profiles.length === 0) return [];

    const counts = await this.prisma.orderAssignment.groupBy({
      by: ['partnerAdminUserId'],
      where: {
        businessId: scope,
        status: 'ACTIVE',
        partnerAdminUserId: { in: profiles.map((p) => p.adminUserId) },
      },
      _count: { _all: true },
    });
    const countByPartner = new Map(counts.map((c) => [c.partnerAdminUserId, c._count._all]));

    return profiles.map((p) => toRow(p, countByPartner.get(p.adminUserId) ?? 0));
  }

  async findByAdminUserId(
    scope: BusinessScope,
    adminUserId: string,
  ): Promise<DeliveryPartnerRow | null> {
    const profile = await this.prisma.deliveryPartnerProfile.findFirst({
      where: { adminUserId, businessId: scope },
      include: PROFILE_INCLUDE,
    });
    if (!profile) return null;

    const activeCount = await this.prisma.orderAssignment.count({
      where: { businessId: scope, partnerAdminUserId: adminUserId, status: 'ACTIVE' },
    });

    return toRow(profile, activeCount);
  }

  async createProfile(
    scope: BusinessScope,
    adminUserId: string,
    input: CreateDeliveryPartnerProfileInput,
  ): Promise<DeliveryPartnerRow> {
    const created = await this.prisma.deliveryPartnerProfile.create({
      data: {
        id: newId(),
        businessId: scope,
        adminUserId,
        vehicleType: input.vehicleType ?? null,
        vehicleNumber: input.vehicleNumber ?? null,
      },
      include: PROFILE_INCLUDE,
    });
    return toRow(created, 0);
  }

  async setDutyStatus(
    scope: BusinessScope,
    adminUserId: string,
    dutyStatus: DutyStatus,
  ): Promise<DeliveryPartnerRow> {
    const updated = await this.prisma.deliveryPartnerProfile.update({
      where: { adminUserId },
      data: { dutyStatus, dutyChangedAt: now() },
      include: PROFILE_INCLUDE,
    });
    void scope;

    const activeCount = await this.prisma.orderAssignment.count({
      where: { businessId: scope, partnerAdminUserId: adminUserId, status: 'ACTIVE' },
    });

    return toRow(updated, activeCount);
  }
}
