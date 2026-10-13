import {
  newId,
  now,
  type BusinessScope,
  type CreateAssignmentInput,
  type OrderAssignmentRepository,
  type OrderAssignmentRow,
} from '@healthy-aahar/core';
import type { Prisma, PrismaClient } from '@healthy-aahar/db';

const ASSIGNMENT_INCLUDE = {
  partner: { select: { fullName: true } },
} satisfies Prisma.OrderAssignmentInclude;

type RawAssignment = Prisma.OrderAssignmentGetPayload<{ include: typeof ASSIGNMENT_INCLUDE }>;

function toRow(raw: RawAssignment): OrderAssignmentRow {
  return {
    id: raw.id,
    orderId: raw.orderId,
    partnerAdminUserId: raw.partnerAdminUserId,
    partnerName: raw.partner.fullName,
    assignedByUserId: raw.assignedByUserId,
    status: raw.status,
    reason: raw.reason,
    assignedAt: raw.assignedAt,
    endedAt: raw.endedAt,
  };
}

/** Prisma implementation of order ↔ delivery-partner assignment history (PHASE 06). */
export class PrismaOrderAssignmentRepository implements OrderAssignmentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async assign(scope: BusinessScope, input: CreateAssignmentInput): Promise<OrderAssignmentRow> {
    const created = await this.prisma.$transaction(async (tx) => {
      // End whatever is currently ACTIVE on this order first — at most one
      // ACTIVE row per order is an invariant this transaction enforces, not
      // a DB constraint (see OrderAssignmentRepository's doc comment).
      await tx.orderAssignment.updateMany({
        where: { orderId: input.orderId, businessId: scope, status: 'ACTIVE' },
        data: { status: 'REASSIGNED', endedAt: now() },
      });

      const row = await tx.orderAssignment.create({
        data: {
          id: newId(),
          businessId: scope,
          orderId: input.orderId,
          partnerAdminUserId: input.partnerAdminUserId,
          assignedByUserId: input.assignedByUserId,
          reason: input.reason ?? null,
          status: 'ACTIVE',
        },
        include: ASSIGNMENT_INCLUDE,
      });

      await tx.order.update({
        where: { id: input.orderId },
        data: { assignedPartnerId: input.partnerAdminUserId, assignedAt: now() },
      });

      return row;
    });

    return toRow(created);
  }

  async closeActive(
    scope: BusinessScope,
    orderId: string,
    status: 'COMPLETED' | 'CANCELLED',
  ): Promise<void> {
    await this.prisma.orderAssignment.updateMany({
      where: { orderId, businessId: scope, status: 'ACTIVE' },
      data: { status, endedAt: now() },
    });
  }

  async getActiveForOrder(
    scope: BusinessScope,
    orderId: string,
  ): Promise<OrderAssignmentRow | null> {
    const row = await this.prisma.orderAssignment.findFirst({
      where: { orderId, businessId: scope, status: 'ACTIVE' },
      include: ASSIGNMENT_INCLUDE,
    });
    return row ? toRow(row) : null;
  }

  async listHistoryForOrder(scope: BusinessScope, orderId: string): Promise<OrderAssignmentRow[]> {
    const rows = await this.prisma.orderAssignment.findMany({
      where: { orderId, businessId: scope },
      include: ASSIGNMENT_INCLUDE,
      orderBy: { assignedAt: 'desc' },
    });
    return rows.map(toRow);
  }

  async countActiveForPartner(scope: BusinessScope, partnerAdminUserId: string): Promise<number> {
    return this.prisma.orderAssignment.count({
      where: { businessId: scope, partnerAdminUserId, status: 'ACTIVE' },
    });
  }
}
