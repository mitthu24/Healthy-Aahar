import type { BusinessScope } from '../domain/business-scope.js';
import { DomainError } from '../domain/errors.js';
import { money } from '../domain/money.js';
import { buildPage, decodeCursor } from '../domain/pagination.js';
import { canTransition, customerDisplayStatus } from '../domain/order-status.js';
import type { OrderRepository, OrderRow } from '../ports/order-repository.js';
import { toOrderView } from './order-view.js';

export type CustomerOrderServiceDeps = { orders: OrderRepository };

/** Customer-facing order history (docs/14 §3.6-3.8). */
export class CustomerOrderService {
  private readonly orders: OrderRepository;

  constructor({ orders }: CustomerOrderServiceDeps) {
    this.orders = orders;
  }

  async list(
    scope: BusinessScope,
    customerProfileId: string,
    filter: { limit: number; cursor?: string },
  ) {
    const page = await this.orders.listForCustomer(scope, customerProfileId, {
      limit: filter.limit + 1,
      cursor: filter.cursor ? decodeCursor(filter.cursor) : undefined,
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
        display_status: customerDisplayStatus(row.status, row.cancelledByType),
        total: money(Number(row.totalPaise)),
        placed_at: row.placedAt.toISOString(),
        item_count: row.items.reduce((sum, item) => sum + item.quantity, 0),
      })),
      pagination: built.pagination,
    };
  }

  async get(scope: BusinessScope, customerProfileId: string, orderId: string) {
    const order = await this.getOwned(scope, customerProfileId, orderId);
    return toOrderView(order);
  }

  async cancel(scope: BusinessScope, customerProfileId: string, orderId: string) {
    const order = await this.getOwned(scope, customerProfileId, orderId);

    const check = canTransition(order.status, 'CANCELLED', 'CUSTOMER');
    if (!check.allowed) {
      throw new DomainError('ORDER_NOT_CANCELLABLE', check.reason);
    }

    const updated = await this.orders.transition(scope, orderId, {
      toStatus: 'CANCELLED',
      actor: 'CUSTOMER',
    });
    return toOrderView(updated);
  }

  private async getOwned(
    scope: BusinessScope,
    customerProfileId: string,
    orderId: string,
  ): Promise<OrderRow> {
    const order = await this.orders.getForCustomer(scope, customerProfileId, orderId);
    if (!order) throw new DomainError('NOT_FOUND', 'Order not found.');
    return order;
  }
}
