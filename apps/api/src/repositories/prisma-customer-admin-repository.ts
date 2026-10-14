import type {
  AccountStatus,
  AdminCustomerListFilter,
  AdminCustomerListPage,
  AdminCustomerRow,
  BusinessScope,
  CustomerAdminRepository,
} from '@healthy-aahar/core';
import { Prisma, type PrismaClient } from '@healthy-aahar/db';

type RawCustomerRow = {
  id: string;
  user_id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  marketing_opt_in: boolean;
  created_at: Date;
  total_orders: number;
  lifetime_value_paise: bigint;
  last_order_at: Date | null;
};

function toRow(raw: RawCustomerRow): AdminCustomerRow {
  return {
    id: raw.id,
    userId: raw.user_id,
    fullName: raw.full_name,
    email: raw.email,
    phone: raw.phone,
    status: raw.status as AccountStatus,
    marketingOptIn: raw.marketing_opt_in,
    createdAt: raw.created_at,
    totalOrders: raw.total_orders,
    lifetimeValuePaise: Number(raw.lifetime_value_paise),
    lastOrderAt: raw.last_order_at,
  };
}

/**
 * Prisma implementation of the founder customer directory (Stage E).
 *
 * `total_orders`/`lifetime_value_paise`/`last_order_at` are aggregated live
 * from `orders` via a `LATERAL` join (one pass per customer row, not N+1 —
 * the planner can push the `customer_profile_id` predicate into the
 * subquery using the existing `orders(customer_profile_id, ...)` access
 * path) — `CustomerProfile`'s own same-named columns are never written by
 * any code in this repo, so they would silently show every customer as
 * having zero orders regardless of history (see the port's doc comment).
 */
export class PrismaCustomerAdminRepository implements CustomerAdminRepository {
  constructor(private readonly prisma: PrismaClient) {}

  private buildWhere(
    scope: BusinessScope,
    filter: AdminCustomerListFilter,
    cursor?: { sortValue: string; id: string },
  ): Prisma.Sql {
    const conditions: Prisma.Sql[] = [Prisma.sql`cp.business_id = ${scope}::uuid`];

    if (filter.q) {
      const like = `%${filter.q.trim()}%`;
      conditions.push(
        Prisma.sql`(cp.display_name ILIKE ${like} OR cp.first_name ILIKE ${like} OR cp.last_name ILIKE ${like} OR u.email ILIKE ${like} OR u.phone ILIKE ${like})`,
      );
    }
    if (filter.status) {
      conditions.push(Prisma.sql`u.status = ${filter.status}::"account_status"`);
    }
    if (cursor) {
      conditions.push(
        Prisma.sql`(cp.created_at, cp.id) < (${new Date(cursor.sortValue)}, ${cursor.id}::uuid)`,
      );
    }

    return Prisma.join(conditions, ' AND ');
  }

  async list(
    scope: BusinessScope,
    filter: AdminCustomerListFilter,
    page: AdminCustomerListPage,
  ): Promise<AdminCustomerRow[]> {
    const where = this.buildWhere(scope, filter, page.cursor);

    const rows = await this.prisma.$queryRaw<RawCustomerRow[]>(Prisma.sql`
      SELECT
        cp.id,
        cp.user_id,
        COALESCE(cp.display_name, NULLIF(TRIM(CONCAT(COALESCE(cp.first_name, ''), ' ', COALESCE(cp.last_name, ''))), '')) AS full_name,
        u.email,
        u.phone,
        u.status::text AS status,
        cp.marketing_opt_in,
        cp.created_at,
        COALESCE(o.total_orders, 0)::int AS total_orders,
        COALESCE(o.lifetime_value_paise, 0)::bigint AS lifetime_value_paise,
        o.last_order_at
      FROM customer_profiles cp
      JOIN users u ON u.id = cp.user_id
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) AS total_orders,
          SUM(ord.total_paise) AS lifetime_value_paise,
          MAX(ord.placed_at) AS last_order_at
        FROM orders ord
        WHERE ord.customer_profile_id = cp.id AND ord.status <> 'CANCELLED'
      ) o ON true
      WHERE ${where}
      ORDER BY cp.created_at DESC, cp.id DESC
      LIMIT ${page.limit}
    `);

    return rows.map(toRow);
  }

  async get(scope: BusinessScope, customerProfileId: string): Promise<AdminCustomerRow | null> {
    const rows = await this.prisma.$queryRaw<RawCustomerRow[]>(Prisma.sql`
      SELECT
        cp.id,
        cp.user_id,
        COALESCE(cp.display_name, NULLIF(TRIM(CONCAT(COALESCE(cp.first_name, ''), ' ', COALESCE(cp.last_name, ''))), '')) AS full_name,
        u.email,
        u.phone,
        u.status::text AS status,
        cp.marketing_opt_in,
        cp.created_at,
        COALESCE(o.total_orders, 0)::int AS total_orders,
        COALESCE(o.lifetime_value_paise, 0)::bigint AS lifetime_value_paise,
        o.last_order_at
      FROM customer_profiles cp
      JOIN users u ON u.id = cp.user_id
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) AS total_orders,
          SUM(ord.total_paise) AS lifetime_value_paise,
          MAX(ord.placed_at) AS last_order_at
        FROM orders ord
        WHERE ord.customer_profile_id = cp.id AND ord.status <> 'CANCELLED'
      ) o ON true
      WHERE cp.business_id = ${scope}::uuid AND cp.id = ${customerProfileId}::uuid
      LIMIT 1
    `);

    return rows[0] ? toRow(rows[0]) : null;
  }

  async listAllForExport(
    scope: BusinessScope,
    filter: AdminCustomerListFilter,
    hardCap: number,
  ): Promise<AdminCustomerRow[]> {
    const where = this.buildWhere(scope, filter);

    const rows = await this.prisma.$queryRaw<RawCustomerRow[]>(Prisma.sql`
      SELECT
        cp.id,
        cp.user_id,
        COALESCE(cp.display_name, NULLIF(TRIM(CONCAT(COALESCE(cp.first_name, ''), ' ', COALESCE(cp.last_name, ''))), '')) AS full_name,
        u.email,
        u.phone,
        u.status::text AS status,
        cp.marketing_opt_in,
        cp.created_at,
        COALESCE(o.total_orders, 0)::int AS total_orders,
        COALESCE(o.lifetime_value_paise, 0)::bigint AS lifetime_value_paise,
        o.last_order_at
      FROM customer_profiles cp
      JOIN users u ON u.id = cp.user_id
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) AS total_orders,
          SUM(ord.total_paise) AS lifetime_value_paise,
          MAX(ord.placed_at) AS last_order_at
        FROM orders ord
        WHERE ord.customer_profile_id = cp.id AND ord.status <> 'CANCELLED'
      ) o ON true
      WHERE ${where}
      ORDER BY cp.created_at DESC, cp.id DESC
      LIMIT ${hardCap}
    `);

    return rows.map(toRow);
  }
}
