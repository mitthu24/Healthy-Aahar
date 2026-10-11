import type { BusinessScope } from '../domain/business-scope.js';
import type { CheckoutRepository, PlaceOrderInput } from '../ports/checkout-repository.js';
import { toOrderView } from './order-view.js';

export type CheckoutServiceDeps = { checkout: CheckoutRepository };

/**
 * Checkout orchestration (docs/09 §4, docs/19; Phase 04 requirement change).
 *
 * This service is intentionally thin: the atomicity that matters (re-reading
 * price/stock, reserving inventory, creating the order, and auto-confirming
 * it) can only be done correctly inside one database transaction, so it
 * lives in the `CheckoutRepository` adapter, not here. This class exists so
 * the route handler depends on a port, not a Prisma client, and so the
 * response shape (`toOrderView`) is computed in one place shared with the
 * customer order list/detail routes.
 */
export class CheckoutService {
  private readonly checkout: CheckoutRepository;

  constructor({ checkout }: CheckoutServiceDeps) {
    this.checkout = checkout;
  }

  async placeOrder(scope: BusinessScope, input: PlaceOrderInput) {
    const order = await this.checkout.placeOrder(scope, input);
    return toOrderView(order);
  }
}
