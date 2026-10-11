import {
  DomainError,
  newId,
  now,
  type BusinessScope,
  type OrderListFilter,
  type OrderRepository,
  type OrderRow,
  type Page,
  type TransitionInput,
} from '@healthy-aahar/core';
import type { PrismaClient } from '@healthy-aahar/db';

import { ORDER_INCLUDE, toOrderRow } from './order-row-mapper.js';

const TIMESTAMP_COLUMN: Record<
  string,
  'confirmedAt' | 'preparedAt' | 'dispatchedAt' | 'deliveredAt' | undefined
> = {
  CONFIRMED: 'confirmedAt',
  PREPARING: 'preparedAt',
  OUT_FOR_DELIVERY: 'dispatchedAt',
  DELIVERED: 'deliveredAt',
};

/** Prisma implementation of order reads and transitions (docs/09, docs/15 §4.1). */
export class PrismaOrderRepository implements OrderRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listForCustomer(
    scope: BusinessScope,
    customerProfileId: string,
    filter: OrderListFilter,
  ): Promise<Page<OrderRow>> {
    const rows = await this.prisma.order.findMany({
      where: {
        businessId: scope,
        customerProfileId,
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.cursor ? { placedAt: { lt: new Date(filter.cursor.sortValue) } } : {}),
      },
      orderBy: { placedAt: 'desc' },
      take: filter.limit,
      include: ORDER_INCLUDE,
    });

    return {
      data: rows.map(toOrderRow),
      pagination: { limit: filter.limit, next_cursor: null, has_more: false },
    };
  }

  async getForCustomer(
    scope: BusinessScope,
    customerProfileId: string,
    orderId: string,
  ): Promise<OrderRow | null> {
    const row = await this.prisma.order.findFirst({
      where: { id: orderId, businessId: scope, customerProfileId },
      include: ORDER_INCLUDE,
    });
    return row ? toOrderRow(row) : null;
  }

  async listForAdmin(scope: BusinessScope, filter: OrderListFilter): Promise<Page<OrderRow>> {
    const rows = await this.prisma.order.findMany({
      where: {
        businessId: scope,
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.cursor ? { placedAt: { lt: new Date(filter.cursor.sortValue) } } : {}),
      },
      orderBy: { placedAt: 'desc' },
      take: filter.limit,
      include: ORDER_INCLUDE,
    });

    return {
      data: rows.map(toOrderRow),
      pagination: { limit: filter.limit, next_cursor: null, has_more: false },
    };
  }

  async getForAdmin(scope: BusinessScope, orderId: string): Promise<OrderRow | null> {
    const row = await this.prisma.order.findFirst({
      where: { id: orderId, businessId: scope },
      include: ORDER_INCLUDE,
    });
    return row ? toOrderRow(row) : null;
  }

  async transition(
    scope: BusinessScope,
    orderId: string,
    input: TransitionInput,
  ): Promise<OrderRow> {
    const existing = await this.prisma.order.findFirst({
      where: { id: orderId, businessId: scope },
    });
    if (!existing) throw new DomainError('NOT_FOUND', 'Order not found.');

    const timestampColumn = TIMESTAMP_COLUMN[input.toStatus];
    const isCancelLike =
      input.toStatus === 'CANCELLED' ||
      input.toStatus === 'FAILED' ||
      input.toStatus === 'RETURNED';

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: {
        status: input.toStatus,
        ...(timestampColumn ? { [timestampColumn]: now() } : {}),
        ...(isCancelLike
          ? {
              cancelledAt: now(),
              cancelledByType: input.actor,
              cancelledByUserId: input.actorUserId ?? null,
              cancellationReason: input.reason ?? null,
            }
          : {}),
      },
      include: ORDER_INCLUDE,
    });

    await this.prisma.orderStatusHistory.create({
      data: {
        id: newId(),
        orderId,
        fromStatus: existing.status,
        toStatus: input.toStatus,
        actorType: input.actor,
        actorUserId: input.actorUserId ?? null,
        reason: input.reason ?? null,
      },
    });

    if (isCancelLike) {
      await this.releaseReservedStock(orderId);
    }

    return toOrderRow(updated);
  }

  async addInternalNote(
    scope: BusinessScope,
    orderId: string,
    note: string,
    actorUserId: string,
  ): Promise<OrderRow> {
    const existing = await this.prisma.order.findFirst({
      where: { id: orderId, businessId: scope },
    });
    if (!existing) throw new DomainError('NOT_FOUND', 'Order not found.');

    const combinedNote = existing.internalNote ? `${existing.internalNote}\n${note}` : note;

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: { internalNote: combinedNote },
      include: ORDER_INCLUDE,
    });

    await this.prisma.orderStatusHistory.create({
      data: {
        id: newId(),
        orderId,
        fromStatus: existing.status,
        toStatus: existing.status,
        actorType: 'ADMIN',
        actorUserId,
        reason: note,
      },
    });

    return toOrderRow(updated);
  }

  async recordCodCollection(
    scope: BusinessScope,
    orderId: string,
    amountPaise: bigint,
    collectedByUserId: string,
  ): Promise<OrderRow> {
    const existing = await this.prisma.order.findFirst({
      where: { id: orderId, businessId: scope },
    });
    if (!existing) throw new DomainError('NOT_FOUND', 'Order not found.');

    // `Order.paymentStatus` and `Payment.status` are kept in lockstep
    // deliberately — the order's own column is what every order read uses,
    // while `Payment` is the detailed, audited record (docs/19 §3: payment
    // status is tracked independently of order/delivery status, never the
    // other way around).
    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: {
        paymentStatus: 'PAID',
        payment: {
          update: {
            status: 'PAID',
            amountPaidPaise: amountPaise,
            paidAt: now(),
            collectedByUserId,
          },
        },
      },
      include: ORDER_INCLUDE,
    });

    return toOrderRow(updated);
  }

  /** CANCELLED/FAILED/RETURNED release whatever stock they had reserved — never left dangling. */
  private async releaseReservedStock(orderId: string): Promise<void> {
    const items = await this.prisma.orderItem.findMany({
      where: { orderId },
      select: { variantId: true, quantity: true },
    });

    for (const item of items) {
      if (!item.variantId) continue;
      const inventory = await this.prisma.inventory.findUnique({
        where: { variantId_locationCode: { variantId: item.variantId, locationCode: 'MAIN' } },
      });
      if (!inventory || !inventory.trackInventory) continue;

      await this.prisma.$executeRaw`
        UPDATE inventory
        SET quantity_reserved = GREATEST(quantity_reserved - ${item.quantity}, 0), updated_at = now()
        WHERE variant_id = ${item.variantId}::uuid AND location_code = 'MAIN'
      `;

      await this.prisma.inventoryMovement.create({
        data: {
          id: newId(),
          inventoryId: inventory.id,
          variantId: item.variantId,
          reason: 'ORDER_RELEASED',
          quantityDelta: 0,
          quantityAfter:
            inventory.quantityOnHand - Math.max(inventory.quantityReserved - item.quantity, 0),
          reservedDelta: -item.quantity,
          referenceType: 'ORDER',
          referenceId: orderId,
          note: 'Released on cancellation',
        },
      });
    }
  }
}
