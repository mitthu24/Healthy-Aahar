/**
 * Order state machine — docs/09 §3, as DATA.
 *
 * PHASE 02 provides the machine and its query functions. The service that
 * applies transitions (and their side effects on capacity, stock and
 * payment) is PHASE 07. Defining the table now means the API, the future
 * bulk endpoint, the worker and any ops tool all consult one definition
 * rather than each reimplementing it (BR-O15).
 *
 * Pure: no I/O, no framework, no persistence.
 */

export type OrderStatusValue =
  | 'PENDING'
  | 'CONFIRMED'
  | 'PREPARING'
  | 'READY_FOR_DISPATCH'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'FAILED'
  | 'RETURNED';

export type TransitionActor = 'CUSTOMER' | 'ADMIN' | 'SYSTEM';

export type OrderTransition = {
  from: OrderStatusValue;
  to: OrderStatusValue;
  /** Who may trigger it. A customer cannot mark their own order delivered. */
  actors: readonly TransitionActor[];
  /** Admin permission required, when an admin triggers it (docs/08). */
  permission?: string;
  /** A reason is mandatory — an unexplained change of this kind is a
   *  governance failure, not a convenience. */
  requiresReason?: boolean;
};

/**
 * Every legal transition. Anything absent is rejected — there is deliberately
 * no "force status" escape hatch (BR-O15).
 */
export const ORDER_TRANSITIONS: readonly OrderTransition[] = [
  {
    from: 'PENDING',
    to: 'CONFIRMED',
    actors: ['ADMIN', 'SYSTEM'],
    permission: 'orders:update_status',
  },
  { from: 'PENDING', to: 'CANCELLED', actors: ['CUSTOMER', 'ADMIN'], permission: 'orders:cancel' },
  { from: 'CONFIRMED', to: 'PREPARING', actors: ['ADMIN'], permission: 'orders:update_status' },
  {
    from: 'CONFIRMED',
    to: 'CANCELLED',
    actors: ['CUSTOMER', 'ADMIN'],
    permission: 'orders:cancel',
  },
  {
    from: 'PREPARING',
    to: 'READY_FOR_DISPATCH',
    actors: ['ADMIN'],
    permission: 'orders:update_status',
  },
  // Past PREPARING the food exists, so only an admin may cancel and must say why.
  {
    from: 'PREPARING',
    to: 'CANCELLED',
    actors: ['ADMIN'],
    permission: 'orders:cancel',
    requiresReason: true,
  },
  {
    from: 'READY_FOR_DISPATCH',
    to: 'OUT_FOR_DELIVERY',
    actors: ['ADMIN'],
    permission: 'orders:update_status',
  },
  {
    from: 'READY_FOR_DISPATCH',
    to: 'CANCELLED',
    actors: ['ADMIN'],
    permission: 'orders:cancel',
    requiresReason: true,
  },
  {
    from: 'OUT_FOR_DELIVERY',
    to: 'DELIVERED',
    actors: ['ADMIN'],
    permission: 'orders:update_status',
  },
  {
    from: 'OUT_FOR_DELIVERY',
    to: 'FAILED',
    actors: ['ADMIN'],
    permission: 'orders:update_status',
    requiresReason: true,
  },
  // Re-attempt on the same service_date only (BR-O12).
  { from: 'FAILED', to: 'OUT_FOR_DELIVERY', actors: ['ADMIN'], permission: 'orders:update_status' },
  {
    from: 'DELIVERED',
    to: 'RETURNED',
    actors: ['ADMIN'],
    permission: 'orders:cancel',
    requiresReason: true,
  },
] as const;

export const TERMINAL_ORDER_STATUSES: readonly OrderStatusValue[] = [
  'DELIVERED',
  'CANCELLED',
  'FAILED',
  'RETURNED',
] as const;

export function isTerminalOrderStatus(status: OrderStatusValue): boolean {
  return TERMINAL_ORDER_STATUSES.includes(status);
}

export function findTransition(
  from: OrderStatusValue,
  to: OrderStatusValue,
): OrderTransition | undefined {
  return ORDER_TRANSITIONS.find((t) => t.from === from && t.to === to);
}

export function allowedTransitionsFrom(from: OrderStatusValue): OrderStatusValue[] {
  return ORDER_TRANSITIONS.filter((t) => t.from === from).map((t) => t.to);
}

export type TransitionCheck =
  | { allowed: true; transition: OrderTransition }
  | { allowed: false; reason: string; allowedTransitions: OrderStatusValue[] };

/**
 * Can this actor move this order from `from` to `to`?
 *
 * Returns the allowed set on refusal so the API can tell the caller what it
 * *could* have done — a bare "invalid transition" forces a doc lookup.
 */
export function canTransition(
  from: OrderStatusValue,
  to: OrderStatusValue,
  actor: TransitionActor,
): TransitionCheck {
  const allowedTransitions = allowedTransitionsFrom(from);

  if (isTerminalOrderStatus(from) && from !== 'FAILED' && from !== 'DELIVERED') {
    return {
      allowed: false,
      reason: `Order is ${from}, which is terminal.`,
      allowedTransitions,
    };
  }

  const transition = findTransition(from, to);
  if (!transition) {
    return {
      allowed: false,
      reason: `Cannot move an order from ${from} to ${to}.`,
      allowedTransitions,
    };
  }

  if (!transition.actors.includes(actor)) {
    return {
      allowed: false,
      reason: `A ${actor.toLowerCase()} cannot move an order from ${from} to ${to}.`,
      allowedTransitions,
    };
  }

  return { allowed: true, transition };
}

/**
 * Subscription lifecycle — docs/11 §2.
 *
 * CANCELLED and EXPIRED are terminal by design: re-activating would revive
 * stale price and plan snapshots, so resubscribing produces a clean contract
 * instead.
 */
export type SubscriptionStatusValue =
  'DRAFT' | 'ACTIVE' | 'PAUSED' | 'CANCELLED' | 'EXPIRED' | 'SUSPENDED';

export const SUBSCRIPTION_TRANSITIONS: readonly {
  from: SubscriptionStatusValue;
  to: SubscriptionStatusValue;
  actors: readonly TransitionActor[];
}[] = [
  { from: 'DRAFT', to: 'ACTIVE', actors: ['CUSTOMER', 'ADMIN'] },
  { from: 'ACTIVE', to: 'PAUSED', actors: ['CUSTOMER', 'ADMIN'] },
  { from: 'PAUSED', to: 'ACTIVE', actors: ['CUSTOMER', 'ADMIN', 'SYSTEM'] },
  { from: 'ACTIVE', to: 'CANCELLED', actors: ['CUSTOMER', 'ADMIN'] },
  { from: 'PAUSED', to: 'CANCELLED', actors: ['CUSTOMER', 'ADMIN'] },
  { from: 'ACTIVE', to: 'EXPIRED', actors: ['SYSTEM'] },
  { from: 'ACTIVE', to: 'SUSPENDED', actors: ['ADMIN', 'SYSTEM'] },
  { from: 'SUSPENDED', to: 'ACTIVE', actors: ['ADMIN'] },
  { from: 'SUSPENDED', to: 'CANCELLED', actors: ['ADMIN'] },
] as const;

export function canTransitionSubscription(
  from: SubscriptionStatusValue,
  to: SubscriptionStatusValue,
  actor: TransitionActor,
): boolean {
  return SUBSCRIPTION_TRANSITIONS.some(
    (t) => t.from === from && t.to === to && t.actors.includes(actor),
  );
}

/** Only an ACTIVE subscription generates deliveries (BR-S4). */
export function generatesDeliveries(status: SubscriptionStatusValue): boolean {
  return status === 'ACTIVE';
}
