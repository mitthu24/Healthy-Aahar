import type { BusinessScope } from '../domain/business-scope.js';
import { DomainError } from '../domain/errors.js';
import { money } from '../domain/money.js';
import { buildPage, decodeCursor } from '../domain/pagination.js';
import { canTransition, type OrderStatusValue } from '../domain/order-status.js';
import type { OrderRepository, OrderRow } from '../ports/order-repository.js';
import { toAdminOrderView } from './order-view.js';

export type OrderFulfilmentServiceDeps = { orders: OrderRepository };

function toOrderSummaryView(row: OrderRow) {
  return {
    id: row.id,
    order_number: row.orderNumber,
    status: row.status,
    payment_method: row.paymentMethod,
    payment_status: row.paymentStatus,
    customer_name: row.customerNameSnapshot,
    total: money(Number(row.totalPaise)),
    service_date: row.serviceDate.toISOString().slice(0, 10),
    placed_at: row.placedAt.toISOString(),
  };
}

/**
 * Admin order fulfilment (docs/15 §4.1; Phase 04 requirement change).
 *
 * Orders arrive already CONFIRMED (checkout auto-confirms). There is no
 * "accept" action here — admin moves a confirmed order through
 * preparing/dispatch/delivery, can cancel ("reject") when delivery turns out
 * infeasible, can flag an order for review without changing its status
 * ("hold"), and records COD collection separately from delivery status
 * (payment_status never implied by order status, docs/19 §3).
 */
export class OrderFulfilmentService {
  private readonly orders: OrderRepository;

  constructor({ orders }: OrderFulfilmentServiceDeps) {
    this.orders = orders;
  }

  async list(
    scope: BusinessScope,
    filter: {
      status?: OrderStatusValue;
      assignedPartnerId?: string;
      unassigned?: boolean;
      limit: number;
      cursor?: string;
    },
  ) {
    const page = await this.orders.listForAdmin(scope, {
      limit: filter.limit + 1,
      cursor: filter.cursor ? decodeCursor(filter.cursor) : undefined,
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.assignedPartnerId ? { assignedPartnerId: filter.assignedPartnerId } : {}),
      ...(filter.unassigned ? { unassigned: filter.unassigned } : {}),
    });

    const built = buildPage(page.data, filter.limit, (row) => ({
      sortValue: row.placedAt.toISOString(),
      id: row.id,
    }));

    return {
      data: built.data.map(toOrderSummaryView),
      pagination: built.pagination,
    };
  }

  async get(scope: BusinessScope, orderId: string) {
    return toAdminOrderView(await this.getOrThrow(scope, orderId));
  }

  /**
   * A single customer's order history (Stage E customer directory) — reuses
   * `OrderRepository.listForCustomer` exactly as the customer's own
   * self-service order list does; the only difference is the CALLER
   * (an admin route gated on `customers:read`, not `customerAuth`), not a
   * second query path. `listForCustomer`'s pagination is simpler than the
   * admin list's (no real cursor, just `take: limit`) — acceptable for a
   * bounded "recent orders" sub-list on a detail page, not a replacement
   * for the full admin order list.
   */
  async listForCustomer(scope: BusinessScope, customerProfileId: string, limit: number) {
    const page = await this.orders.listForCustomer(scope, customerProfileId, { limit });
    return page.data.map(toOrderSummaryView);
  }

  /** Move the order forward (preparing / ready / out-for-delivery / delivered / failed-retry). */
  async updateStatus(
    scope: BusinessScope,
    orderId: string,
    actorUserId: string,
    toStatus: OrderStatusValue,
    reason?: string,
  ) {
    const order = await this.getOrThrow(scope, orderId);

    const check = canTransition(order.status, toStatus, 'ADMIN');
    if (!check.allowed) {
      throw new DomainError('INVALID_STATUS_TRANSITION', check.reason, {
        context: { allowedTransitions: check.allowedTransitions },
      });
    }
    if (check.transition.requiresReason && !reason?.trim()) {
      throw new DomainError('VALIDATION_FAILED', 'A reason is required for this transition.', {
        details: [{ field: 'reason', issue: 'required' }],
      });
    }

    const updated = await this.orders.transition(scope, orderId, {
      toStatus,
      actor: 'ADMIN',
      actorUserId,
      reason,
    });
    return toAdminOrderView(updated);
  }

  /** "Reject" — cancel a confirmed order because delivery is infeasible. Reuses CANCELLED; the
   *  customer app renders it as "Rejected" via `cancelled_by_type` (no new order status). */
  async reject(scope: BusinessScope, orderId: string, actorUserId: string, reason: string) {
    const order = await this.getOrThrow(scope, orderId);

    const check = canTransition(order.status, 'CANCELLED', 'ADMIN');
    if (!check.allowed) {
      throw new DomainError('ORDER_NOT_CANCELLABLE', check.reason);
    }

    const updated = await this.orders.transition(scope, orderId, {
      toStatus: 'CANCELLED',
      actor: 'ADMIN',
      actorUserId,
      reason,
    });
    return toAdminOrderView(updated);
  }

  /** "Hold" — flag for operational follow-up WITHOUT changing order status (req. 8, 10). */
  async hold(scope: BusinessScope, orderId: string, actorUserId: string, note: string) {
    await this.getOrThrow(scope, orderId);
    const updated = await this.orders.addInternalNote(
      scope,
      orderId,
      `[HOLD] ${note}`,
      actorUserId,
    );
    return toAdminOrderView(updated);
  }

  async recordCodCollection(
    scope: BusinessScope,
    orderId: string,
    actorUserId: string,
    amountPaise: bigint,
  ) {
    const order = await this.getOrThrow(scope, orderId);

    if (order.paymentMethod !== 'COD') {
      throw new DomainError('VALIDATION_FAILED', 'This order is not a COD order.');
    }
    if (order.paymentStatus === 'PAID') {
      throw new DomainError(
        'VALIDATION_FAILED',
        'COD collection was already recorded for this order.',
      );
    }

    const updated = await this.orders.recordCodCollection(scope, orderId, amountPaise, actorUserId);
    return toAdminOrderView(updated);
  }

  private async getOrThrow(scope: BusinessScope, orderId: string) {
    const order = await this.orders.getForAdmin(scope, orderId);
    if (!order) throw new DomainError('NOT_FOUND', 'Order not found.');
    return order;
  }
}
