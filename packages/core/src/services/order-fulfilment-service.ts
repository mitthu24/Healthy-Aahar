import type { BusinessScope } from '../domain/business-scope.js';
import { DomainError } from '../domain/errors.js';
import { money } from '../domain/money.js';
import { buildPage, decodeCursor } from '../domain/pagination.js';
import { canTransition, type OrderStatusValue } from '../domain/order-status.js';
import { resolveBusinessDateRange, type BusinessDate } from '../domain/time.js';
import type { OrderRepository } from '../ports/order-repository.js';
import { toAdminOrderView } from './order-view.js';

export type OrderFulfilmentServiceDeps = { orders: OrderRepository };

/** Same bound the dashboard's date-range queries use — keeps every
 *  business-date-range report in this codebase subject to one documented
 *  ceiling (Stage D §5). */
const MAX_RANGE_DAYS = 366;

export type OrderCountsView = {
  total: number;
  by_status: Array<{ status: OrderStatusValue; count: number }>;
};

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
      /** Business-date pair (`YYYY-MM-DD`); both required together or omitted together — enforced by the route's contract. */
      from?: BusinessDate;
      to?: BusinessDate;
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
      ...(filter.from && filter.to
        ? { placedRange: this.resolveRange({ from: filter.from, to: filter.to }) }
        : {}),
    });

    const built = buildPage(page.data, filter.limit, (row) => ({
      sortValue: row.placedAt.toISOString(),
      id: row.id,
    }));

    return {
      data: built.data.map((row) => ({
        id: row.id,
        order_number: row.orderNumber,
        status: row.status,
        payment_method: row.paymentMethod,
        payment_status: row.paymentStatus,
        customer_name: row.customerNameSnapshot,
        total: money(Number(row.totalPaise)),
        service_date: row.serviceDate.toISOString().slice(0, 10),
        placed_at: row.placedAt.toISOString(),
      })),
      pagination: built.pagination,
    };
  }

  async get(scope: BusinessScope, orderId: string) {
    return toAdminOrderView(await this.getOrThrow(scope, orderId));
  }

  /**
   * Per-status order counts for the Orders dashboard's tabs, computed by a
   * single aggregated query (never by paging through `list()` client-side —
   * ADR: avoid N+1 / unbounded retrieval). Keyed on `placed_at`, matching
   * `list()`'s own date-filter field, so the tab counts and the order list
   * always agree on which orders are "in range."
   */
  async getCounts(
    scope: BusinessScope,
    input: { from: BusinessDate; to: BusinessDate },
  ): Promise<OrderCountsView> {
    const range = this.resolveRange(input);
    const rows = await this.orders.getStatusCounts(scope, range);
    const total = rows.reduce((sum, row) => sum + row.count, 0);
    return { total, by_status: rows.map((row) => ({ status: row.status, count: row.count })) };
  }

  private resolveRange(input: { from: BusinessDate; to: BusinessDate }): {
    from: Date;
    to: Date;
  } {
    return resolveBusinessDateRange(input, {
      maxRangeDays: MAX_RANGE_DAYS,
      onInvalid: (message) => {
        throw new DomainError('VALIDATION_FAILED', message);
      },
    });
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
