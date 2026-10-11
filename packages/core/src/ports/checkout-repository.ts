import type { BusinessScope } from '../domain/business-scope.js';
import type { OrderRow } from './order-repository.js';

/**
 * Checkout (docs/09 §4, docs/19 §2-3; Phase 04 requirement change).
 *
 * `placeOrder` is ONE atomic operation, not a sequence the service layer
 * stitches together, because every step must succeed or none may: price and
 * stock are re-read live, inventory is reserved with a conditional UPDATE
 * (no lost-update race under concurrency), the order/items/payment rows are
 * created, and the order is immediately auto-confirmed (PENDING -> CONFIRMED,
 * actor SYSTEM, the existing transition) — all inside one database
 * transaction. A thrown error leaves no partial order and no phantom
 * reservation (BR-O/Phase04 req. 3).
 *
 * Idempotency is handled inside the same transaction via the `IdempotencyKey`
 * row: a repeat request with the same key either returns the original result
 * (if it already completed) or fails cleanly (if it is still in flight or the
 * key was reused with a different payload) — it never creates a second order
 * (Phase04 req. 4, req. 12).
 */

export type PlaceOrderInput = {
  businessId: string;
  customerProfileId: string;
  addressId: string;
  deliverySlotId: string;
  serviceDate: string;
  customerNote?: string | undefined;
  idempotencyKey: string;
  requestHash: string;
};

export interface CheckoutRepository {
  placeOrder(scope: BusinessScope, input: PlaceOrderInput): Promise<OrderRow>;
}
