import type { BusinessScope } from '../domain/business-scope.js';
import type { DutyStatus } from '../domain/duty-status.js';
import { DomainError } from '../domain/errors.js';
import { canTransition, type OrderStatusValue } from '../domain/order-status.js';
import { money } from '../domain/money.js';
import { buildPage, decodeCursor } from '../domain/pagination.js';
import { now } from '../domain/time.js';
import type { AuditLogRepository } from '../ports/audit-log-repository.js';
import type { DeliveryPartnerRepository } from '../ports/delivery-partner-repository.js';
import type { OrderAssignmentRepository } from '../ports/order-assignment-repository.js';
import type { OrderRepository, OrderRow } from '../ports/order-repository.js';

export type DeliveryFulfilmentServiceDeps = {
  orders: OrderRepository;
  assignments: OrderAssignmentRepository;
  partners: DeliveryPartnerRepository;
  audit: AuditLogRepository;
};

function toDeliveryOrderView(order: OrderRow) {
  return {
    id: order.id,
    order_number: order.orderNumber,
    status: order.status as 'READY_FOR_DISPATCH' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'FAILED',
    recipient_name: order.addressSnapshot.recipientName,
    recipient_phone: order.addressSnapshot.recipientPhone,
    delivery_address: order.addressSnapshot,
    items: order.items.map((item) => ({
      id: item.id,
      product_name: item.productName,
      variant_name: item.variantName,
      image_url: item.imageUrl,
      quantity: item.quantity,
      unit_price: money(Number(item.unitPricePaise)),
      line_total: money(Number(item.lineTotalPaise)),
    })),
    payment_method: order.paymentMethod,
    cod_amount_due:
      order.paymentMethod === 'COD' && order.paymentStatus !== 'PAID'
        ? money(Number(order.totalPaise))
        : null,
    cod_collected: order.paymentMethod === 'COD' && order.paymentStatus === 'PAID',
    service_date: order.serviceDate.toISOString().slice(0, 10),
    slot_name: order.slotNameSnapshot,
    customer_note: order.customerNote,
    assigned_at: order.assignedAt?.toISOString() ?? null,
    failure_reason: order.status === 'FAILED' ? order.cancellationReason : null,
  };
}

/**
 * Delivery partner's own self-service surface (PHASE 06): duty toggle,
 * their assigned deliveries, and the delivery lifecycle actions on an order
 * — EVERY method here is scoped to the calling partner's own
 * `partnerAdminUserId` via `OrderRepository.getForPartner`/`listForPartner`,
 * which filter by `assignedPartnerId` in the query itself (never "fetch
 * then check"), so an order not assigned to this partner is simply not
 * found — same anti-enumeration NOT_FOUND-not-FORBIDDEN convention
 * `assertInScope` uses for cross-business access elsewhere in this codebase.
 */
export class DeliveryFulfilmentService {
  private readonly orders: OrderRepository;
  private readonly assignments: OrderAssignmentRepository;
  private readonly partners: DeliveryPartnerRepository;
  private readonly audit: AuditLogRepository;

  constructor({ orders, assignments, partners, audit }: DeliveryFulfilmentServiceDeps) {
    this.orders = orders;
    this.assignments = assignments;
    this.partners = partners;
    this.audit = audit;
  }

  async getDashboard(scope: BusinessScope, partnerAdminUserId: string) {
    const partner = await this.partners.findByAdminUserId(scope, partnerAdminUserId);
    if (!partner) throw new DomainError('PARTNER_NOT_FOUND', 'Delivery partner profile not found.');

    const assigned = await this.orders.listForPartner(scope, partnerAdminUserId, { limit: 200 });
    const activeCount = assigned.data.filter((o) =>
      ['READY_FOR_DISPATCH', 'OUT_FOR_DELIVERY'].includes(o.status),
    ).length;
    const today = now().toISOString().slice(0, 10);
    const completedTodayCount = assigned.data.filter(
      (o) => o.status === 'DELIVERED' && o.serviceDate.toISOString().slice(0, 10) === today,
    ).length;

    return {
      full_name: partner.fullName,
      duty_status: partner.dutyStatus,
      assigned_count: assigned.data.length,
      active_count: activeCount,
      completed_today_count: completedTodayCount,
    };
  }

  async setDutyStatus(
    scope: BusinessScope,
    partnerAdminUserId: string,
    dutyStatus: DutyStatus,
    actorUserId: string,
  ) {
    const partner = await this.partners.findByAdminUserId(scope, partnerAdminUserId);
    if (!partner) throw new DomainError('PARTNER_NOT_FOUND', 'Delivery partner profile not found.');

    // Going off-duty never touches an existing assignment — a partner
    // mid-delivery keeps it; off-duty only stops NEW assignments reaching
    // them (enforced in OrderAssignmentService.assign).
    const updated = await this.partners.setDutyStatus(scope, partnerAdminUserId, dutyStatus);

    await this.audit.write(scope, {
      // `audit_logs.actor_user_id` has a real FK to `users.id` — unlike
      // `order_status_history.actor_user_id` elsewhere in this codebase,
      // which by convention actually holds an admin_users id, this column
      // does not tolerate that substitution (a foreign-key violation, not a
      // silent inconsistency). actorUserId here is deliberately the
      // caller's real `users.id`, threaded in separately from
      // partnerAdminUserId.
      actorUserId,
      actorType: 'ADMIN',
      action: 'delivery_partner.duty_status_changed',
      resourceType: 'delivery_partner',
      resourceId: partnerAdminUserId,
      metadata: { duty_status: dutyStatus },
    });

    return updated;
  }

  async listMyDeliveries(
    scope: BusinessScope,
    partnerAdminUserId: string,
    filter: { status?: OrderStatusValue; limit: number; cursor?: string },
  ) {
    const page = await this.orders.listForPartner(scope, partnerAdminUserId, {
      limit: filter.limit + 1,
      cursor: filter.cursor ? decodeCursor(filter.cursor) : undefined,
      ...(filter.status ? { status: filter.status } : {}),
    });

    const built = buildPage(page.data, filter.limit, (row) => ({
      sortValue: row.placedAt.toISOString(),
      id: row.id,
    }));

    return {
      data: built.data.map((row) => {
        const view = toDeliveryOrderView(row);
        return {
          id: view.id,
          order_number: view.order_number,
          status: view.status,
          recipient_name: view.recipient_name,
          delivery_address: view.delivery_address,
          service_date: view.service_date,
          slot_name: view.slot_name,
          assigned_at: view.assigned_at,
        };
      }),
      pagination: built.pagination,
    };
  }

  async getMyDelivery(scope: BusinessScope, partnerAdminUserId: string, orderId: string) {
    const order = await this.getOwnedOrThrow(scope, partnerAdminUserId, orderId);
    return toDeliveryOrderView(order);
  }

  /** Accept the assignment / start the trip: READY_FOR_DISPATCH → OUT_FOR_DELIVERY. */
  async acceptAndDispatch(
    scope: BusinessScope,
    partnerAdminUserId: string,
    orderId: string,
    actorUserId: string,
  ) {
    const order = await this.getOwnedOrThrow(scope, partnerAdminUserId, orderId);
    return this.applyTransition(scope, partnerAdminUserId, order, 'OUT_FOR_DELIVERY', actorUserId);
  }

  async markDelivered(
    scope: BusinessScope,
    partnerAdminUserId: string,
    orderId: string,
    actorUserId: string,
  ) {
    const order = await this.getOwnedOrThrow(scope, partnerAdminUserId, orderId);
    const updated = await this.applyTransition(
      scope,
      partnerAdminUserId,
      order,
      'DELIVERED',
      actorUserId,
    );
    await this.assignments.closeActive(scope, orderId, 'COMPLETED');
    return updated;
  }

  async markFailed(
    scope: BusinessScope,
    partnerAdminUserId: string,
    orderId: string,
    reason: string,
    actorUserId: string,
  ) {
    const order = await this.getOwnedOrThrow(scope, partnerAdminUserId, orderId);
    return this.applyTransition(scope, partnerAdminUserId, order, 'FAILED', actorUserId, reason);
  }

  async recordCodCollection(
    scope: BusinessScope,
    partnerAdminUserId: string,
    orderId: string,
    amountPaise: bigint,
    actorUserId: string,
  ) {
    const order = await this.getOwnedOrThrow(scope, partnerAdminUserId, orderId);

    if (order.paymentMethod !== 'COD') {
      throw new DomainError('VALIDATION_FAILED', 'This order is not a COD order.');
    }
    if (order.paymentStatus === 'PAID') {
      throw new DomainError(
        'VALIDATION_FAILED',
        'COD collection was already recorded for this order.',
      );
    }

    const updated = await this.orders.recordCodCollection(
      scope,
      orderId,
      amountPaise,
      partnerAdminUserId,
    );

    await this.audit.write(scope, {
      actorUserId,
      actorType: 'ADMIN',
      action: 'delivery.cod_collected',
      resourceType: 'order',
      resourceId: orderId,
      metadata: { amount_paise: amountPaise.toString() },
    });

    return toDeliveryOrderView(updated);
  }

  private async getOwnedOrThrow(
    scope: BusinessScope,
    partnerAdminUserId: string,
    orderId: string,
  ): Promise<OrderRow> {
    const order = await this.orders.getForPartner(scope, partnerAdminUserId, orderId);
    if (!order) throw new DomainError('NOT_FOUND', 'Order not found.');
    return order;
  }

  private async applyTransition(
    scope: BusinessScope,
    partnerAdminUserId: string,
    order: OrderRow,
    toStatus: OrderStatusValue,
    actorUserId: string,
    reason?: string,
  ) {
    const check = canTransition(order.status, toStatus, 'DELIVERY_PARTNER');
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

    const updated = await this.orders.transition(scope, order.id, {
      toStatus,
      actor: 'DELIVERY_PARTNER',
      // order_status_history.actor_user_id holds an admin_users id by this
      // codebase's existing convention (OrderFulfilmentService does the
      // same) — no FK constraint there, unlike the audit log below.
      actorUserId: partnerAdminUserId,
      reason,
    });

    await this.audit.write(scope, {
      actorUserId,
      actorType: 'ADMIN',
      action: `delivery.status_${toStatus.toLowerCase()}`,
      resourceType: 'order',
      resourceId: order.id,
      metadata: reason ? { reason } : undefined,
    });

    return toDeliveryOrderView(updated);
  }
}
