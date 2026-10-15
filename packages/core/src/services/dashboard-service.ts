import type { BusinessScope } from '../domain/business-scope.js';
import { DomainError } from '../domain/errors.js';
import { money, type Money } from '../domain/money.js';
import { resolveBusinessDateRange, type BusinessDate } from '../domain/time.js';
import type {
  DashboardRepository,
  OrderStatusCount,
  SalesTrendPoint,
} from '../ports/dashboard-repository.js';

/** Query validation rejects a span wider than this — bounds every aggregate
 *  query's row count to something a founder-scale business can run ad hoc,
 *  without needing a pre-aggregated summary table (Stage D §5, "avoid
 *  unbounded record retrieval"). A business asking for a longer trend should
 *  get a real, documented limit, not a silently truncated or runaway query. */
const MAX_RANGE_DAYS = 366;

export type DashboardDateRangeInput = { from: BusinessDate; to: BusinessDate };

export type DashboardSummaryView = {
  order_count: number;
  gross_sales: Money;
  discounts: Money;
  cancelled_count: number;
  cancelled_value: Money;
  net_sales: Money;
  /** `net_sales / order_count` for non-cancelled orders — `null` with zero orders. */
  average_order_value: Money | null;
  collected: Money;
  refunded: Money;
  outstanding_cod: Money;
  status_breakdown: OrderStatusCount[];
  delivery: {
    delivered_count: number;
    failed_count: number;
    avg_fulfilment_minutes: number | null;
    /** Fraction in [0, 1] of delivered orders that were on time — `null` when nothing was delivered. */
    on_time_rate: number | null;
  };
  new_customers_count: number;
};

export type SalesTrendPointView = { date: string; order_count: number; gross_sales: Money };
export type TopProductView = {
  variant_id: string;
  product_name: string;
  quantity: number;
  revenue: Money;
};
export type InventoryAlertView = {
  variant_id: string;
  product_name: string;
  quantity_on_hand: number;
  quantity_reserved: number;
  quantity_available: number;
  low_stock_threshold: number;
};

export type DashboardServiceDeps = { dashboard: DashboardRepository };

/**
 * Founder analytics (Stage D).
 *
 * Every financial figure here is deliberately defined, not improvised —
 * see each field's doc comment on `DashboardSummaryRow`/`DashboardSummaryView`.
 * The two load-bearing decisions this service makes, both because the
 * schema does not resolve them on its own:
 *
 *  - "Collected" revenue reads `Payment.amountPaidPaise`, never inferred
 *    from `Order.status` — a DELIVERED COD order has NOT been collected
 *    until `DeliveryFulfilmentService.recordCodCollection` actually ran
 *    (confirmed by reading that service: it refuses to re-collect once
 *    `Payment.status` is already PAID, and is the only writer of
 *    `amountPaidPaise`). Treating "delivered" as "collected" would silently
 *    overstate real cash in hand for every COD order still awaiting
 *    collection.
 *  - "Net sales" is gross sales minus CANCELLED-order value only. FAILED
 *    and RETURNED orders stay in net sales: both represent a real
 *    delivery/fulfilment attempt with real cost already incurred, unlike
 *    CANCELLED (which never shipped). This is a judgment call, documented
 *    here rather than silently baked into one SQL query.
 */
export class DashboardService {
  private readonly dashboard: DashboardRepository;

  constructor({ dashboard }: DashboardServiceDeps) {
    this.dashboard = dashboard;
  }

  private resolveRange(input: DashboardDateRangeInput): { from: Date; to: Date } {
    return resolveBusinessDateRange(input, {
      maxRangeDays: MAX_RANGE_DAYS,
      onInvalid: (message) => {
        throw new DomainError('VALIDATION_FAILED', message);
      },
    });
  }

  async getSummary(
    scope: BusinessScope,
    input: DashboardDateRangeInput,
  ): Promise<DashboardSummaryView> {
    const range = this.resolveRange(input);
    const row = await this.dashboard.getSummary(scope, range);

    const nonCancelledCount = row.orderCount - row.cancelledCount;

    return {
      order_count: row.orderCount,
      gross_sales: money(row.grossSalesPaise),
      discounts: money(row.discountPaise),
      cancelled_count: row.cancelledCount,
      cancelled_value: money(row.cancelledValuePaise),
      net_sales: money(row.netSalesPaise),
      average_order_value:
        nonCancelledCount > 0 ? money(Math.round(row.netSalesPaise / nonCancelledCount)) : null,
      collected: money(row.collectedPaise),
      refunded: money(row.refundedPaise),
      outstanding_cod: money(row.outstandingCodPaise),
      status_breakdown: row.statusBreakdown,
      delivery: {
        delivered_count: row.deliveredCount,
        failed_count: row.failedCount,
        avg_fulfilment_minutes: row.avgFulfilmentMinutes,
        on_time_rate: row.deliveredCount > 0 ? row.onTimeDeliveredCount / row.deliveredCount : null,
      },
      new_customers_count: row.newCustomersCount,
    };
  }

  async getSalesTrend(
    scope: BusinessScope,
    input: DashboardDateRangeInput,
  ): Promise<SalesTrendPointView[]> {
    const range = this.resolveRange(input);
    const points: SalesTrendPoint[] = await this.dashboard.getSalesTrend(scope, range);
    return points.map((p) => ({
      date: p.date,
      order_count: p.orderCount,
      gross_sales: money(p.grossSalesPaise),
    }));
  }

  async getTopProducts(
    scope: BusinessScope,
    input: DashboardDateRangeInput,
    limit: number,
  ): Promise<TopProductView[]> {
    const range = this.resolveRange(input);
    const rows = await this.dashboard.getTopProducts(scope, range, limit);
    return rows.map((r) => ({
      variant_id: r.variantId,
      product_name: r.productName,
      quantity: r.quantity,
      revenue: money(r.revenuePaise),
    }));
  }

  async getInventoryAlerts(scope: BusinessScope, limit: number): Promise<InventoryAlertView[]> {
    const rows = await this.dashboard.getInventoryAlerts(scope, limit);
    return rows.map((r) => ({
      variant_id: r.variantId,
      product_name: r.productName,
      quantity_on_hand: r.quantityOnHand,
      quantity_reserved: r.quantityReserved,
      quantity_available: r.quantityOnHand - r.quantityReserved,
      low_stock_threshold: r.lowStockThreshold,
    }));
  }
}
