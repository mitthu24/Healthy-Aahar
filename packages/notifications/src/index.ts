/**
 * Notification ports (docs/18-NOTIFICATION-ARCHITECTURE.md §3).
 *
 * Business logic depends on this interface and never on a provider SDK.
 * Adding WhatsApp or push is a new adapter plus a routing-table entry, with
 * zero changes to order or subscription code (BR-N2, BR-N10).
 *
 * PHASE 11 implements the Brevo and in-app adapters and the outbox dispatcher.
 */

export type NotificationChannelName = 'IN_APP' | 'EMAIL' | 'WHATSAPP' | 'PUSH' | 'SMS';

export type Recipient = {
  userId: string;
  email?: string;
  phone?: string;
  deviceTokens?: string[];
};

export type OutboundMessage = {
  recipient: Recipient;
  templateKey: string;
  variables: Record<string, unknown>;
  locale: string;
  /** Makes at-least-once delivery harmless (BR-N3). */
  dedupeKey: string;
};

export type ChannelResult =
  | { status: 'SENT'; providerMessageId?: string }
  | { status: 'SKIPPED'; reason: string }
  | { status: 'FAILED'; error: string; retryable: boolean };

export interface NotificationChannel {
  readonly channel: NotificationChannelName;
  isAvailable(recipient: Recipient): boolean;
  send(message: OutboundMessage): Promise<ChannelResult>;
}

/**
 * The channel used in every non-production environment.
 *
 * This is not a convenience — it is the mechanism that makes it structurally
 * impossible for staging to contact a real customer (BR-N9, BR-ENV3).
 */
export class NoopChannel implements NotificationChannel {
  constructor(readonly channel: NotificationChannelName) {}

  isAvailable(): boolean {
    return true;
  }

  async send(message: OutboundMessage): Promise<ChannelResult> {
    return {
      status: 'SKIPPED',
      reason: `Noop channel (${this.channel}): ${message.templateKey}`,
    };
  }
}

/** Captures messages instead of sending them, so tests can assert on them. */
export class CapturingChannel implements NotificationChannel {
  readonly sent: OutboundMessage[] = [];

  constructor(readonly channel: NotificationChannelName) {}

  isAvailable(): boolean {
    return true;
  }

  async send(message: OutboundMessage): Promise<ChannelResult> {
    this.sent.push(message);
    return { status: 'SENT', providerMessageId: `test-${this.sent.length}` };
  }
}
