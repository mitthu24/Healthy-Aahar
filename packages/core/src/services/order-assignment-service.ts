import type { BusinessScope } from '../domain/business-scope.js';
import { DomainError } from '../domain/errors.js';
import type { AuditLogRepository } from '../ports/audit-log-repository.js';
import type { DeliveryPartnerRepository } from '../ports/delivery-partner-repository.js';
import type { OrderAssignmentRepository } from '../ports/order-assignment-repository.js';
import type { OrderRepository } from '../ports/order-repository.js';
import { toAdminOrderView } from './order-view.js';

export type OrderAssignmentServiceDeps = {
  orders: OrderRepository;
  assignments: OrderAssignmentRepository;
  partners: DeliveryPartnerRepository;
  audit: AuditLogRepository;
};

/** Orders assignable to a delivery partner — before dispatch is pointless, after delivery is done. */
const ASSIGNABLE_STATUSES = new Set(['READY_FOR_DISPATCH', 'OUT_FOR_DELIVERY']);

/**
 * Admin-side order ↔ delivery-partner assignment (PHASE 06, docs requirement
 * "order assignment from admin"). Deliberately separate from
 * `OrderFulfilmentService` — assignment never changes order STATUS, only who
 * is responsible for it (the two are orthogonal, same principle as
 * `payment_status` being independent of order status elsewhere in this
 * codebase).
 */
export class OrderAssignmentService {
  private readonly orders: OrderRepository;
  private readonly assignments: OrderAssignmentRepository;
  private readonly partners: DeliveryPartnerRepository;
  private readonly audit: AuditLogRepository;

  constructor({ orders, assignments, partners, audit }: OrderAssignmentServiceDeps) {
    this.orders = orders;
    this.assignments = assignments;
    this.partners = partners;
    this.audit = audit;
  }

  async assign(
    scope: BusinessScope,
    params: { orderId: string; partnerAdminUserId: string; actorUserId: string; reason?: string },
  ) {
    const order = await this.orders.getForAdmin(scope, params.orderId);
    if (!order) throw new DomainError('NOT_FOUND', 'Order not found.');

    if (!ASSIGNABLE_STATUSES.has(order.status)) {
      throw new DomainError(
        'ORDER_NOT_ASSIGNABLE',
        `An order in status ${order.status} cannot be assigned to a delivery partner.`,
      );
    }

    const partner = await this.partners.findByAdminUserId(scope, params.partnerAdminUserId);
    if (!partner) throw new DomainError('PARTNER_NOT_FOUND', 'Delivery partner not found.');
    if (partner.deactivated) {
      throw new DomainError(
        'PARTNER_NOT_FOUND',
        'This delivery partner account is suspended and cannot receive assignments.',
      );
    }
    if (partner.dutyStatus !== 'ON_DUTY') {
      throw new DomainError(
        'PARTNER_OFF_DUTY',
        'This delivery partner is off duty and cannot receive new assignments.',
      );
    }

    const isReassignment = order.assignedPartnerId !== null;
    if (isReassignment && !params.reason?.trim()) {
      throw new DomainError('VALIDATION_FAILED', 'A reason is required to reassign an order.', {
        details: [{ field: 'reason', issue: 'required' }],
      });
    }

    await this.assignments.assign(scope, {
      orderId: params.orderId,
      partnerAdminUserId: params.partnerAdminUserId,
      assignedByUserId: params.actorUserId,
      reason: params.reason,
    });

    await this.audit.write(scope, {
      actorUserId: params.actorUserId,
      actorType: 'ADMIN',
      action: isReassignment ? 'order.reassigned' : 'order.assigned',
      resourceType: 'order',
      resourceId: params.orderId,
      metadata: { partner_admin_user_id: params.partnerAdminUserId, reason: params.reason ?? null },
    });

    const updated = await this.orders.getForAdmin(scope, params.orderId);
    if (!updated) throw new DomainError('NOT_FOUND', 'Order not found.');
    return toAdminOrderView(updated);
  }

  async history(scope: BusinessScope, orderId: string) {
    const order = await this.orders.getForAdmin(scope, orderId);
    if (!order) throw new DomainError('NOT_FOUND', 'Order not found.');
    return this.assignments.listHistoryForOrder(scope, orderId);
  }

  /** On-duty, non-suspended partners — "see eligible delivery partners" (docs requirement). */
  async listEligiblePartners(scope: BusinessScope) {
    const partners = await this.partners.list(scope, { dutyStatus: 'ON_DUTY' });
    return partners.filter((p) => !p.deactivated);
  }
}
