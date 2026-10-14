import type { BusinessScope } from '../domain/business-scope.js';

export type AssignmentStatusValue = 'ACTIVE' | 'REASSIGNED' | 'COMPLETED' | 'CANCELLED';

export type OrderAssignmentRow = {
  id: string;
  orderId: string;
  partnerAdminUserId: string;
  partnerName: string;
  assignedByUserId: string;
  status: AssignmentStatusValue;
  reason: string | null;
  assignedAt: Date;
  endedAt: Date | null;
};

export type CreateAssignmentInput = {
  orderId: string;
  partnerAdminUserId: string;
  assignedByUserId: string;
  reason?: string | undefined;
};

export interface OrderAssignmentRepository {
  /**
   * Ends whatever assignment is currently ACTIVE on this order (status
   * REASSIGNED, `endedAt` stamped) and creates the new ACTIVE row, then
   * updates `orders.assigned_partner_id`/`assigned_at` — all in one
   * transaction, so "double-assign" (two concurrently-ACTIVE rows for the
   * same order) cannot happen.
   */
  assign(scope: BusinessScope, input: CreateAssignmentInput): Promise<OrderAssignmentRow>;
  /** Closes the currently-ACTIVE assignment (delivery completed/cancelled) without creating a new one. */
  closeActive(
    scope: BusinessScope,
    orderId: string,
    status: 'COMPLETED' | 'CANCELLED',
  ): Promise<void>;
  getActiveForOrder(scope: BusinessScope, orderId: string): Promise<OrderAssignmentRow | null>;
  listHistoryForOrder(scope: BusinessScope, orderId: string): Promise<OrderAssignmentRow[]>;
  countActiveForPartner(scope: BusinessScope, partnerAdminUserId: string): Promise<number>;
}
