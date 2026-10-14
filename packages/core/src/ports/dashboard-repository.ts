import type { BusinessScope } from '../domain/business-scope.js';

/**
 * Founder analytics (Stage D). Every amount here is raw integer paise — the
 * service layer wraps each one in `money()` before it reaches a response,
 * exactly like every other money field in this codebase (ADR-006).
 *
 * `from`/`to` are absolute UTC instants, already resolved from business
 * dates by the service layer via `businessDateTimeToUtc` — this port never
 * sees a bare date string or does timezone math itself.
 */
export type DashboardDateRange = {
  /** Inclusive lower bound. */
  from: Date;
  /** Exclusive upper bound. */
  to: Date;
};

export type OrderStatusCount = { status: string; count: number };

export type DashboardSummaryRow = {
  orderCount: number;
  grossSalesPaise: number;
  discountPaise: number;
  cancelledCount: number;
  cancelledValuePaise: number;
  /** gross sales minus cancelled-order value — see DashboardService doc comment. */
  netSalesPaise: number;
  /** Sum of `Payment.amountPaidPaise` — actual recorded collections, never
   *  inferred from order/delivery status (a delivered COD order is NOT
   *  "collected" until `recordCodCollection` actually ran). */
  collectedPaise: number;
  /** Sum of `Payment.amountRefundedPaise`. */
  refundedPaise: number;
  /** COD orders not yet collected and not cancelled: `amountPaise -
   *  amountPaidPaise` on open COD payments. */
  outstandingCodPaise: number;
  statusBreakdown: OrderStatusCount[];
  deliveredCount: number;
  failedCount: number;
  /** Mean minutes from `placedAt` to `deliveredAt` for DELIVERED orders in
   *  range. `null` when there are no delivered orders (never fabricated as 0). */
  avgFulfilmentMinutes: number | null;
  /** Of the delivered orders, how many had `deliveredAt`'s business DATE
   *  (Asia/Kolkata) on or before the order's own `serviceDate`. */
  onTimeDeliveredCount: number;
  /** CustomerProfile rows whose `firstOrderAt` falls in this range. */
  newCustomersCount: number;
};

export type SalesTrendPoint = {
  /** Business date (Asia/Kolkata), `YYYY-MM-DD`. */
  date: string;
  orderCount: number;
  grossSalesPaise: number;
};

export type TopProductRow = {
  variantId: string;
  productName: string;
  quantity: number;
  revenuePaise: number;
};

export type InventoryAlertRow = {
  variantId: string;
  productName: string;
  quantityOnHand: number;
  quantityReserved: number;
  lowStockThreshold: number;
};

export interface DashboardRepository {
  getSummary(scope: BusinessScope, range: DashboardDateRange): Promise<DashboardSummaryRow>;
  getSalesTrend(scope: BusinessScope, range: DashboardDateRange): Promise<SalesTrendPoint[]>;
  getTopProducts(
    scope: BusinessScope,
    range: DashboardDateRange,
    limit: number,
  ): Promise<TopProductRow[]>;
  /** Not date-ranged — a live snapshot of current stock. */
  getInventoryAlerts(scope: BusinessScope, limit: number): Promise<InventoryAlertRow[]>;
}
