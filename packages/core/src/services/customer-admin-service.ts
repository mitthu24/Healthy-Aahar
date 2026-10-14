import type { BusinessScope } from '../domain/business-scope.js';
import { DomainError } from '../domain/errors.js';
import { money } from '../domain/money.js';
import { decodeCursor, encodeCursor } from '../domain/pagination.js';
import { maskEmail, maskPhone } from '../domain/pii-masking.js';
import type { AuditLogRepository } from '../ports/audit-log-repository.js';
import type {
  AdminCustomerListFilter,
  AdminCustomerRow,
  CustomerAdminRepository,
} from '../ports/customer-admin-repository.js';
import type { OrderFulfilmentService } from './order-fulfilment-service.js';

export type CustomerAdminServiceDeps = {
  customers: CustomerAdminRepository;
  orders: OrderFulfilmentService;
  audit: AuditLogRepository;
};

const EXPORT_HARD_CAP = 5_000;

/**
 * Founder customer directory (Stage E).
 *
 * Masking policy, deliberately simple and auditable:
 *  - `list`/`get` ALWAYS mask email/phone, regardless of the caller's
 *    permissions — a directory/detail VIEW never needs the real value, and
 *    always-masking here means there is exactly one path that can ever
 *    expose real PII, which is easy to audit completely.
 *  - `revealPii` is that one path: gated by `customers:read_pii` at the
 *    route layer (not here — this service trusts the route already
 *    checked it, same pattern as every other permission-gated service),
 *    and writes an audit event on every single call, successful or not
 *    attempted twice — "audited on every unmask" from the permission
 *    catalogue's own doc comment, taken literally.
 */
export class CustomerAdminService {
  private readonly customers: CustomerAdminRepository;
  private readonly orders: OrderFulfilmentService;
  private readonly audit: AuditLogRepository;

  constructor({ customers, orders, audit }: CustomerAdminServiceDeps) {
    this.customers = customers;
    this.orders = orders;
    this.audit = audit;
  }

  async list(
    scope: BusinessScope,
    filter: AdminCustomerListFilter,
    page: { limit: number; cursor?: string | undefined },
  ) {
    // Fetch one extra row to determine has_more without a second COUNT
    // query — same `limit+1` pattern as `buildPage`, done inline since this
    // repository returns a plain array, not a `Page<T>`.
    const rows = await this.customers.list(scope, filter, {
      limit: page.limit + 1,
      cursor: page.cursor ? decodeCursor(page.cursor) : undefined,
    });

    const hasMore = rows.length > page.limit;
    const data = hasMore ? rows.slice(0, page.limit) : rows;
    const last = data[data.length - 1];

    return {
      data: data.map(toMaskedView),
      pagination: {
        limit: page.limit,
        next_cursor:
          hasMore && last
            ? encodeCursor({ sortValue: last.createdAt.toISOString(), id: last.id })
            : null,
        has_more: hasMore,
      },
    };
  }

  async get(scope: BusinessScope, customerProfileId: string) {
    const row = await this.customers.get(scope, customerProfileId);
    if (!row) throw new DomainError('NOT_FOUND', 'Customer not found.');

    const recentOrders = await this.orders.listForCustomer(scope, customerProfileId, 10);

    return { ...toMaskedView(row), recent_orders: recentOrders };
  }

  /**
   * The ONE path that ever returns real contact details. The route layer
   * has already enforced `customers:read_pii`; this method's own job is
   * only to audit the read and return the unmasked row — it does not
   * re-check the permission (same division of responsibility as every
   * other service in this codebase: routes/middleware own authorization,
   * services own business logic).
   */
  async revealPii(scope: BusinessScope, customerProfileId: string, actorUserId: string) {
    const row = await this.customers.get(scope, customerProfileId);

    await this.audit.write(scope, {
      actorUserId,
      actorType: 'ADMIN',
      action: 'customer.pii_unmasked',
      resourceType: 'customer_profile',
      resourceId: customerProfileId,
      metadata: { found: row !== null },
    });

    if (!row) throw new DomainError('NOT_FOUND', 'Customer not found.');

    return {
      id: row.id,
      email: row.email,
      phone: row.phone,
    };
  }

  async listForExport(scope: BusinessScope, filter: AdminCustomerListFilter) {
    const rows = await this.customers.listAllForExport(scope, filter, EXPORT_HARD_CAP);
    return rows.map(toMaskedView);
  }
}

function toMaskedView(row: AdminCustomerRow) {
  return {
    id: row.id,
    user_id: row.userId,
    full_name: row.fullName,
    email: row.email ? maskEmail(row.email) : null,
    phone: row.phone ? maskPhone(row.phone) : null,
    status: row.status,
    marketing_opt_in: row.marketingOptIn,
    created_at: row.createdAt.toISOString(),
    total_orders: row.totalOrders,
    lifetime_value: money(row.lifetimeValuePaise),
    last_order_at: row.lastOrderAt ? row.lastOrderAt.toISOString() : null,
  };
}

