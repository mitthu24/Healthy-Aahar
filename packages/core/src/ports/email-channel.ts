/**
 * Minimal structural port for sending a single admin-facing transactional
 * email (Stage F — "send a real email" for password reset). Deliberately
 * NOT imported from `@healthy-aahar/notifications` (that package already
 * depends on `core`; importing it back here would be circular) — this
 * interface is shaped to match `NotificationChannel.send` structurally, so
 * `apps/api` can pass a real `NotificationChannel` instance (today:
 * `NoopChannel`, honestly reporting `SKIPPED` — no Brevo adapter exists yet,
 * see docs/18 §3 "PHASE 11") straight through without an adapter class.
 */
export type EmailSendResult =
  | { status: 'SENT'; providerMessageId?: string }
  | { status: 'SKIPPED'; reason: string }
  | { status: 'FAILED'; error: string; retryable: boolean };

export interface EmailChannel {
  isAvailable(recipient: { email?: string }): boolean;
  send(message: {
    recipient: { userId: string; email?: string };
    templateKey: string;
    variables: Record<string, unknown>;
    locale: string;
    dedupeKey: string;
  }): Promise<EmailSendResult>;
}
