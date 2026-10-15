import type {
  BusinessScope,
  DashboardDateRange,
  DashboardRepository,
  DashboardSummaryRow,
  InventoryAlertRow,
  OrderStatusCount,
  SalesTrendPoint,
  TopProductRow,
} from '@healthy-aahar/core';
import { Prisma, type PrismaClient } from '@healthy-aahar/db';

/**
 * Prisma implementation of founder analytics (Stage D).
 *
 * Aggregation runs in SQL, not pulled into application code and summed —
 * `getSummary`/`getSalesTrend`/`getTopProducts` filter to a bounded
 * `[from, to)` range (enforced by `DashboardService`'s `MAX_RANGE_DAYS`,
 * e.g. covered by the existing `orders(business_id, placed_at DESC)`
 * index) before any aggregate runs, and `getInventoryAlerts` filters to
 * already-low rows in SQL rather than fetching the whole catalogue and
 * filtering in JS.
 *
 * All raw queries use `Prisma.sql` tagged templates — every interpolated
 * value becomes a bound parameter, never string-concatenated into the
 * query text.
 */
export class PrismaDashboardRepository implements DashboardRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getSummary(scope: BusinessScope, range: DashboardDateRange): Promise<DashboardSummaryRow> {
    const [totals] = await this.prisma.$queryRaw<
      Array<{
        order_count: number;
        gross_sales_paise: bigint;
        discount_paise: bigint;
        cancelled_count: number;
        cancelled_value_paise: bigint;
        net_sales_paise: bigint;
        collected_paise: bigint;
        refunded_paise: bigint;
        outstanding_cod_paise: bigint;
        delivered_count: number;
        failed_count: number;
        avg_fulfilment_minutes: number | null;
        on_time_delivered_count: number;
      }>
    >(Prisma.sql`
      SELECT
        COUNT(*)::int AS order_count,
        COALESCE(SUM(o.total_paise), 0)::bigint AS gross_sales_paise,
        COALESCE(SUM(o.discount_paise), 0)::bigint AS discount_paise,
        COUNT(*) FILTER (WHERE o.status = 'CANCELLED')::int AS cancelled_count,
        COALESCE(SUM(o.total_paise) FILTER (WHERE o.status = 'CANCELLED'), 0)::bigint AS cancelled_value_paise,
        COALESCE(SUM(o.total_paise) FILTER (WHERE o.status <> 'CANCELLED'), 0)::bigint AS net_sales_paise,
        COALESCE(SUM(p.amount_paid_paise), 0)::bigint AS collected_paise,
        COALESCE(SUM(p.amount_refunded_paise), 0)::bigint AS refunded_paise,
        COALESCE(SUM(p.amount_paise - p.amount_paid_paise) FILTER (
          WHERE p.method = 'COD' AND p.status NOT IN ('REFUNDED', 'CANCELLED') AND o.status <> 'CANCELLED'
        ), 0)::bigint AS outstanding_cod_paise,
        COUNT(*) FILTER (WHERE o.status = 'DELIVERED')::int AS delivered_count,
        COUNT(*) FILTER (WHERE o.status = 'FAILED')::int AS failed_count,
        (AVG(EXTRACT(EPOCH FROM (o.delivered_at - o.placed_at)) / 60.0) FILTER (
          WHERE o.status = 'DELIVERED' AND o.delivered_at IS NOT NULL
        ))::float8 AS avg_fulfilment_minutes,
        COUNT(*) FILTER (
          WHERE o.status = 'DELIVERED' AND o.delivered_at IS NOT NULL
            AND (o.delivered_at AT TIME ZONE 'Asia/Kolkata')::date <= o.service_date
        )::int AS on_time_delivered_count
      FROM orders o
      LEFT JOIN payments p ON p.order_id = o.id
      WHERE o.business_id = ${scope}::uuid
        AND o.placed_at >= ${range.from}
        AND o.placed_at < ${range.to}
    `);

    const statusRows = await this.prisma.order.groupBy({
      by: ['status'],
      where: { businessId: scope, placedAt: { gte: range.from, lt: range.to } },
      _count: { _all: true },
    });
    const statusBreakdown: OrderStatusCount[] = statusRows.map((r) => ({
      status: r.status,
      count: r._count._all,
    }));

    const newCustomersCount = await this.prisma.customerProfile.count({
      where: { businessId: scope, firstOrderAt: { gte: range.from, lt: range.to } },
    });

    return {
      orderCount: totals?.order_count ?? 0,
      grossSalesPaise: Number(totals?.gross_sales_paise ?? 0n),
      discountPaise: Number(totals?.discount_paise ?? 0n),
      cancelledCount: totals?.cancelled_count ?? 0,
      cancelledValuePaise: Number(totals?.cancelled_value_paise ?? 0n),
      netSalesPaise: Number(totals?.net_sales_paise ?? 0n),
      collectedPaise: Number(totals?.collected_paise ?? 0n),
      refundedPaise: Number(totals?.refunded_paise ?? 0n),
      outstandingCodPaise: Number(totals?.outstanding_cod_paise ?? 0n),
      statusBreakdown,
      deliveredCount: totals?.delivered_count ?? 0,
      failedCount: totals?.failed_count ?? 0,
      avgFulfilmentMinutes: totals?.avg_fulfilment_minutes ?? null,
      onTimeDeliveredCount: totals?.on_time_delivered_count ?? 0,
      newCustomersCount,
    };
  }

  async getSalesTrend(scope: BusinessScope, range: DashboardDateRange): Promise<SalesTrendPoint[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{ day: Date; order_count: number; gross_sales_paise: bigint }>
    >(Prisma.sql`
      SELECT
        (o.placed_at AT TIME ZONE 'Asia/Kolkata')::date AS day,
        COUNT(*)::int AS order_count,
        COALESCE(SUM(o.total_paise), 0)::bigint AS gross_sales_paise
      FROM orders o
      WHERE o.business_id = ${scope}::uuid
        AND o.placed_at >= ${range.from}
        AND o.placed_at < ${range.to}
      GROUP BY day
      ORDER BY day ASC
    `);

    return rows.map((r) => ({
      date: r.day.toISOString().slice(0, 10),
      orderCount: r.order_count,
      grossSalesPaise: Number(r.gross_sales_paise),
    }));
  }

  async getTopProducts(
    scope: BusinessScope,
    range: DashboardDateRange,
    limit: number,
  ): Promise<TopProductRow[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        variant_id: string;
        product_name: string;
        quantity: number;
        revenue_paise: bigint;
      }>
    >(Prisma.sql`
      SELECT
        oi.variant_id,
        MAX(oi.product_name_snapshot) AS product_name,
        SUM(oi.quantity)::int AS quantity,
        COALESCE(SUM(oi.line_total_paise), 0)::bigint AS revenue_paise
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE o.business_id = ${scope}::uuid
        AND o.placed_at >= ${range.from}
        AND o.placed_at < ${range.to}
        AND o.status <> 'CANCELLED'
        AND oi.is_component = false
        AND oi.variant_id IS NOT NULL
      GROUP BY oi.variant_id
      ORDER BY revenue_paise DESC
      LIMIT ${limit}
    `);

    return rows.map((r) => ({
      variantId: r.variant_id,
      productName: r.product_name,
      quantity: r.quantity,
      revenuePaise: Number(r.revenue_paise),
    }));
  }

  async getInventoryAlerts(scope: BusinessScope, limit: number): Promise<InventoryAlertRow[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        variant_id: string;
        product_name: string;
        quantity_on_hand: number;
        quantity_reserved: number;
        low_stock_threshold: number;
      }>
    >(Prisma.sql`
      SELECT
        i.variant_id,
        v.name AS product_name,
        i.quantity_on_hand,
        i.quantity_reserved,
        i.low_stock_threshold
      FROM inventory i
      JOIN product_variants v ON v.id = i.variant_id
      WHERE i.business_id = ${scope}::uuid
        AND i.track_inventory = true
        AND (i.quantity_on_hand - i.quantity_reserved) <= i.low_stock_threshold
      ORDER BY (i.quantity_on_hand - i.quantity_reserved) ASC
      LIMIT ${limit}
    `);

    return rows.map((r) => ({
      variantId: r.variant_id,
      productName: r.product_name,
      quantityOnHand: r.quantity_on_hand,
      quantityReserved: r.quantity_reserved,
      lowStockThreshold: r.low_stock_threshold,
    }));
  }
}
