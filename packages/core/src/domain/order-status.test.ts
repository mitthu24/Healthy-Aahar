import { describe, expect, it } from 'vitest';

import {
  allowedTransitionsFrom,
  canTransition,
  canTransitionSubscription,
  generatesDeliveries,
  isTerminalOrderStatus,
  ORDER_TRANSITIONS,
  type OrderStatusValue,
} from './order-status.js';

const ALL_STATUSES: OrderStatusValue[] = [
  'PENDING',
  'CONFIRMED',
  'PREPARING',
  'READY_FOR_DISPATCH',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'CANCELLED',
  'FAILED',
  'RETURNED',
];

describe('order state machine — the happy path', () => {
  it('walks the documented lifecycle end to end', () => {
    const path: [OrderStatusValue, OrderStatusValue][] = [
      ['PENDING', 'CONFIRMED'],
      ['CONFIRMED', 'PREPARING'],
      ['PREPARING', 'READY_FOR_DISPATCH'],
      ['READY_FOR_DISPATCH', 'OUT_FOR_DELIVERY'],
      ['OUT_FOR_DELIVERY', 'DELIVERED'],
    ];

    for (const [from, to] of path) {
      expect(canTransition(from, to, 'ADMIN').allowed).toBe(true);
    }
  });
});

describe('order state machine — who may do what', () => {
  it('lets a customer cancel while PENDING or CONFIRMED', () => {
    expect(canTransition('PENDING', 'CANCELLED', 'CUSTOMER').allowed).toBe(true);
    expect(canTransition('CONFIRMED', 'CANCELLED', 'CUSTOMER').allowed).toBe(true);
  });

  it('stops a customer cancelling once the food is being made', () => {
    // Past PREPARING the produce is committed, so only an admin may cancel
    // and must give a reason (BR-O5).
    const result = canTransition('PREPARING', 'CANCELLED', 'CUSTOMER');

    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toContain('customer');
  });

  it('stops a customer marking their own order delivered', () => {
    expect(canTransition('OUT_FOR_DELIVERY', 'DELIVERED', 'CUSTOMER').allowed).toBe(false);
  });

  it('requires a reason for cancellations after preparation has begun', () => {
    const result = canTransition('PREPARING', 'CANCELLED', 'ADMIN');
    expect(result.allowed).toBe(true);
    if (result.allowed) expect(result.transition.requiresReason).toBe(true);
  });

  it('does not require a reason for a pre-cutoff customer cancellation', () => {
    const result = canTransition('PENDING', 'CANCELLED', 'CUSTOMER');
    if (result.allowed) expect(result.transition.requiresReason).toBeUndefined();
  });
});

describe('order state machine — refusals', () => {
  it('rejects a backwards transition', () => {
    // A mistake is corrected by cancelling and re-creating, which leaves an
    // honest audit trail (docs/09 §3.1).
    expect(canTransition('DELIVERED', 'PREPARING', 'ADMIN').allowed).toBe(false);
    expect(canTransition('OUT_FOR_DELIVERY', 'CONFIRMED', 'ADMIN').allowed).toBe(false);
  });

  it('rejects skipping a state that has no direct edge', () => {
    expect(canTransition('PENDING', 'DELIVERED', 'ADMIN').allowed).toBe(false);
  });

  it('rejects any transition out of CANCELLED or RETURNED', () => {
    for (const to of ALL_STATUSES) {
      expect(canTransition('CANCELLED', to, 'ADMIN').allowed).toBe(false);
      expect(canTransition('RETURNED', to, 'ADMIN').allowed).toBe(false);
    }
  });

  it('returns the allowed set on refusal so the caller is not left guessing', () => {
    const result = canTransition('PENDING', 'DELIVERED', 'ADMIN');

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.allowedTransitions).toContain('CONFIRMED');
      expect(result.allowedTransitions).toContain('CANCELLED');
      expect(result.allowedTransitions).not.toContain('DELIVERED');
    }
  });

  it('has no "force status" escape hatch anywhere in the table', () => {
    // Every edge must name its actors; a wildcard would defeat the machine.
    for (const transition of ORDER_TRANSITIONS) {
      expect(transition.actors.length).toBeGreaterThan(0);
      expect(transition.from).not.toBe(transition.to);
    }
  });
});

describe('order state machine — recovery paths', () => {
  it('allows a failed delivery to be re-attempted', () => {
    expect(canTransition('FAILED', 'OUT_FOR_DELIVERY', 'ADMIN').allowed).toBe(true);
  });

  it('allows a delivered order to be returned', () => {
    const result = canTransition('DELIVERED', 'RETURNED', 'ADMIN');
    expect(result.allowed).toBe(true);
    if (result.allowed) expect(result.transition.requiresReason).toBe(true);
  });
});

describe('terminal statuses', () => {
  it.each(['DELIVERED', 'CANCELLED', 'FAILED', 'RETURNED'] as OrderStatusValue[])(
    '%s is terminal',
    (status) => {
      expect(isTerminalOrderStatus(status)).toBe(true);
    },
  );

  it.each(['PENDING', 'CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY'] as OrderStatusValue[])(
    '%s is not terminal',
    (status) => {
      expect(isTerminalOrderStatus(status)).toBe(false);
    },
  );

  it('leaves every non-terminal status with somewhere to go', () => {
    // A non-terminal status with no outbound edge would strand orders.
    for (const status of ALL_STATUSES) {
      if (!isTerminalOrderStatus(status)) {
        expect(allowedTransitionsFrom(status).length).toBeGreaterThan(0);
      }
    }
  });
});

describe('subscription lifecycle', () => {
  it('allows pause and resume', () => {
    expect(canTransitionSubscription('ACTIVE', 'PAUSED', 'CUSTOMER')).toBe(true);
    expect(canTransitionSubscription('PAUSED', 'ACTIVE', 'CUSTOMER')).toBe(true);
  });

  it('lets the system auto-resume a pause that has expired', () => {
    expect(canTransitionSubscription('PAUSED', 'ACTIVE', 'SYSTEM')).toBe(true);
  });

  it('refuses to revive a cancelled subscription', () => {
    // Reviving would resurrect stale price and plan snapshots; resubscribing
    // produces a clean, correctly-priced contract instead (docs/11 §2).
    expect(canTransitionSubscription('CANCELLED', 'ACTIVE', 'ADMIN')).toBe(false);
    expect(canTransitionSubscription('EXPIRED', 'ACTIVE', 'ADMIN')).toBe(false);
  });

  it('lets only an admin lift a suspension', () => {
    expect(canTransitionSubscription('SUSPENDED', 'ACTIVE', 'ADMIN')).toBe(true);
    expect(canTransitionSubscription('SUSPENDED', 'ACTIVE', 'CUSTOMER')).toBe(false);
  });

  it('generates deliveries only while ACTIVE', () => {
    expect(generatesDeliveries('ACTIVE')).toBe(true);
    for (const status of ['PAUSED', 'SUSPENDED', 'CANCELLED', 'EXPIRED', 'DRAFT'] as const) {
      expect(generatesDeliveries(status)).toBe(false);
    }
  });
});
