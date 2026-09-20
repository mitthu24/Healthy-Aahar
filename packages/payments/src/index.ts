/**
 * Payment gateway port (docs/19-PAYMENT-ARCHITECTURE.md §4).
 *
 * Cash on Delivery is implemented as a PROVIDER, not a special case. That is
 * deliberate: the abstraction is exercised by real production traffic from day
 * one, so adding Razorpay in PHASE 17 is a second implementation of a proven
 * interface rather than a speculative one that turns out not to fit (ADR-014).
 *
 * `capabilities` is what lets one checkout flow serve every provider. Code
 * outside the gateway registry must never branch on `provider` (BR-P11).
 */

export type PaymentProvider = 'COD' | 'RAZORPAY' | 'STRIPE';

export type PaymentCapabilities = {
  /** COD: false. An online gateway: true. The client checks this, not the
   *  provider name. */
  requiresClientAction: boolean;
  supportsRefund: boolean;
  supportsWebhook: boolean;
  /** For subscription auto-debit in PHASE 17. */
  supportsRecurring: boolean;
};

export type InitiatePaymentInput = {
  orderId: string;
  amountPaise: number;
  currency: 'INR';
  idempotencyKey: string;
};

export type InitiatePaymentResult = {
  status: 'DUE' | 'AUTHORIZED' | 'FAILED';
  providerOrderId?: string;
  clientPayload?: Record<string, unknown>;
};

export type RefundInput = {
  paymentId: string;
  providerPaymentId?: string;
  amountPaise: number;
  reason: string;
};

export type RefundResult = {
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  providerRefundId?: string;
};

export interface PaymentGateway {
  readonly provider: PaymentProvider;
  readonly capabilities: PaymentCapabilities;
  initiate(input: InitiatePaymentInput): Promise<InitiatePaymentResult>;
  refund(input: RefundInput): Promise<RefundResult>;
}

/** Cash on Delivery. Money moves at the door; the record is created here. */
export class CashOnDeliveryGateway implements PaymentGateway {
  readonly provider = 'COD' as const;

  readonly capabilities: PaymentCapabilities = {
    requiresClientAction: false,
    supportsRefund: true, // a manual cash return or a credit note
    supportsWebhook: false,
    supportsRecurring: false,
  };

  async initiate(): Promise<InitiatePaymentResult> {
    // Nothing to charge yet: COD becomes PAID only on DELIVERED (BR-P4).
    return { status: 'DUE' };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    // Recorded for reconciliation; the physical return is an operational act.
    return { status: 'PENDING', providerRefundId: `cod-${input.paymentId}` };
  }
}
