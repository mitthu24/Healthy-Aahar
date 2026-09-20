# 18 — Notification Architecture

## 1. The problem this design solves

The naive approach calls `brevo.sendEmail()` inside `placeOrder()`. Three failures follow:
an email outage rolls back or breaks a paid order; adding WhatsApp means editing order code;
and a retry sends a duplicate email. All three are avoided by publishing an **event** inside
the order transaction and dispatching it separately.

```
placeOrder()  ──[same transaction]──►  notification_outbox: ORDER_PLACED
                                              │
                        worker: dispatch-outbox (every 15s)
                                              │
                                     NotificationService
                          ┌───────────┬───────┴────┬───────────┐
                       In-app      Email       WhatsApp      Push
                     (MVP ✅)   (MVP ✅)       (P3)          (P3)
```

Order code emits one row. It knows nothing about channels, templates or providers. Adding
WhatsApp later is a new adapter and a routing-table entry — **zero changes to order,
subscription or payment logic** (ADR-015).

## 2. Transactional outbox

```sql
BEGIN;
  INSERT INTO orders ...;
  INSERT INTO order_items ...;
  INSERT INTO notification_outbox (event_type, aggregate_type, aggregate_id, payload, dedupe_key)
       VALUES ('ORDER_PLACED', 'order', $1, $2, 'ORDER_PLACED:' || $1);
COMMIT;
```

**Guarantees**
- *No lost notifications.* If the order commits, the event commits. There is no window where
  an order exists and its event does not.
- *No phantom notifications.* If the order rolls back, so does the event. We never email
  about an order that was never created.
- *No coupling.* A Brevo outage delays email; it cannot fail an order.
- *At-least-once delivery* with `dedupe_key` making duplicates harmless.

The payload is **self-contained** — it carries the customer name, order number, items, slot
window and totals at the moment of the event. The dispatcher performs no lookups. This means
a notification sent at 20:00 describes the state at 11:42, which is correct: "your order was
placed" should not silently become "your order was cancelled" because the row changed.

### Dispatcher

```sql
UPDATE notification_outbox
   SET status='PROCESSING', attempts = attempts + 1
 WHERE id IN (
   SELECT id FROM notification_outbox
    WHERE status IN ('PENDING','FAILED')
      AND next_attempt_at <= now()
      AND available_at   <= now()
    ORDER BY created_at
    LIMIT 50
    FOR UPDATE SKIP LOCKED          -- multiple workers never collide
 )
RETURNING *;
```

`FOR UPDATE SKIP LOCKED` is what makes the dispatcher horizontally scalable without a queue
broker. `available_at` supports scheduled sends (a reminder written now, delivered at 20:00).

**Retry:** exponential backoff at 1m, 5m, 15m, 1h, 6h. After 5 attempts the row becomes
`DEAD` and raises an alert. `DEAD` rows are visible in the admin notification log and can be
replayed manually.

## 3. Ports and adapters

```ts
// packages/notifications
interface NotificationChannel {
  readonly channel: 'IN_APP' | 'EMAIL' | 'WHATSAPP' | 'PUSH' | 'SMS';
  isAvailable(recipient: Recipient): boolean;
  send(message: OutboundMessage): Promise<ChannelResult>;
}

interface OutboundMessage {
  recipient: Recipient;               // resolved addresses, never raw DB rows
  templateKey: string;                // 'order_placed'
  variables: Record<string, unknown>; // from the outbox payload
  locale: string;                     // 'en-IN'
  dedupeKey: string;
}
```

Adapters: `InAppChannel` (writes `notifications`), `BrevoEmailChannel`,
`WhatsAppChannel` (P3), `PushChannel` (P3), `SmsChannel` (FUT), plus `NoopChannel` for
non-production environments and `CapturingChannel` for tests.

**No domain service imports a provider SDK.** Brevo appears in exactly one file. Replacing it
with Resend or SES is one adapter and one environment variable.

## 4. Event catalogue

| Event | In-app | Email | WhatsApp (P3) | Push (P3) | Notes |
|---|:--:|:--:|:--:|:--:|---|
| `CUSTOMER_REGISTERED` | ✅ | ✅ | ○ | — | Welcome |
| `ORDER_PLACED` | ✅ | ✅ | ✅ | ✅ | Confirmation with slot |
| `ORDER_CONFIRMED` | ✅ | ○ | ✅ | ✅ | In-app only by default — avoids two emails in ten minutes |
| `ORDER_PREPARING` | ✅ | ○ | ○ | ✅ | |
| `ORDER_OUT_FOR_DELIVERY` | ✅ | ○ | ✅ | ✅ | The highest-value moment |
| `ORDER_DELIVERED` | ✅ | ✅ | ✅ | ✅ | Receipt + review prompt (P2) |
| `ORDER_CANCELLED` | ✅ | ✅ | ✅ | ✅ | With reason |
| `ORDER_FAILED` | ✅ | ✅ | ✅ | ✅ | With next steps |
| `SUBSCRIPTION_CREATED` | ✅ | ✅ | ✅ | ○ | Schedule summary |
| `SUBSCRIPTION_ORDER_CREATED` | ✅ | ○ | ○ | ✅ | Tomorrow's order exists |
| `SUBSCRIPTION_DELIVERY_REMINDER` | ✅ | ✅ | ✅ | ✅ | 20:00 the day before — the skip window |
| `SUBSCRIPTION_PAUSED` / `_RESUMED` | ✅ | ✅ | ✅ | ○ | |
| `SUBSCRIPTION_SKIPPED` | ✅ | ○ | ✅ | ○ | |
| `SUBSCRIPTION_CANCELLED` | ✅ | ✅ | ✅ | ○ | |
| `SUBSCRIPTION_SUSPENDED` | ✅ | ✅ | ✅ | ✅ | Requires action |
| `SUBSCRIPTION_DELIVERY_FAILED` | ✅ | ✅ | ✅ | ✅ | Apology + resolution |
| `SUBSCRIPTION_REPRICED` | ✅ | ✅ | ✅ | ○ | Advance notice (BR-S7) |
| `ADDRESS_UNSERVICEABLE` | ✅ | ✅ | ✅ | ○ | Zone change (BR-S15) |
| `PAYMENT_RECEIVED` (P4) | ✅ | ✅ | ✅ | ○ | |
| `REFUND_INITIATED` / `_COMPLETED` (P2) | ✅ | ✅ | ✅ | ○ | |
| `LOW_STOCK` (admin) | ✅ | ✅ | — | — | Internal |
| `SUBSCRIPTION_AT_RISK` (admin) | ✅ | ✅ | — | — | Internal |

The routing table lives in `packages/notifications/src/routing.ts` as data, so enabling
WhatsApp for an event is a one-line change reviewed like any other.

## 5. Categories and consent

| Category | Opt-out | Examples |
|---|---|---|
| `TRANSACTIONAL` | ❌ No | Order confirmations, failures, cancellations |
| `REMINDER` | ✅ Yes | Delivery reminders |
| `MARKETING` | ✅ **Opt-in required** | Offers, new products |

`notification_preferences` (per user × channel × category) is consulted before every send.
`customer_profiles.marketing_opt_in` defaults to `false` and requires an explicit, unticked
checkbox. Every marketing email carries a one-click unsubscribe honoured through the Brevo
webhook, which writes back to our preferences so the state lives in our database, not only
in Brevo's.

## 6. Email via Brevo

Templates are authored in Brevo so non-engineers can edit copy, and referenced by a stable
key mapped in code:

```ts
const BREVO_TEMPLATES = {
  order_placed:  { id: 1, requiredVars: ['customer_name','order_number','items',
                                         'slot_window','service_date','total_display'] },
  // ...
} as const;
```

The `requiredVars` list is asserted at send time and in a CI check, so an editor renaming a
variable in Brevo produces a failing test rather than an email containing `{{params.total}}`.

**Sender identity:** dedicated subdomain `mail.maindomain.com` with SPF, DKIM and DMARC
(`p=quarantine` after a warm-up period). Transactional and marketing use separate sender
identities, so a marketing complaint rate can never affect order-confirmation deliverability.

**Inbound webhook** `/v1/webhooks/brevo` records `delivered`, `opened`, `bounced`,
`spam`, `unsubscribed` into `notification_logs`; hard bounces mark the address invalid and
suppress future sends.

## 7. In-app notifications

Written synchronously by `InAppChannel` into `notifications`, surfaced in the customer app's
bell with an unread count. This is the only channel with no external dependency, so it is
the reliability floor: even with Brevo down, the customer sees what happened.

## 8. WhatsApp and push readiness (P3)

Nothing about adding them requires changing existing code:

| Need | Already exists |
|---|---|
| Event stream | `notification_outbox` |
| Per-channel delivery log | `notification_logs.channel` |
| Consent | `notification_preferences` |
| Recipient phone | `users.phone` (E.164, OTP-verified) |
| Device tokens | `POST /v1/me/devices` specified in doc 06 |
| Routing | `routing.ts` data table |
| Channel contract | `NotificationChannel` |

Full plan in [20-WHATSAPP-FUTURE-INTEGRATION.md](20-WHATSAPP-FUTURE-INTEGRATION.md).

## 9. Observability

| Metric | Alert |
|---|---|
| Outbox depth (`PENDING`) | > 500 for 5 min |
| Oldest pending age | > 5 min |
| `DEAD` rows | any, daily digest |
| Email bounce rate | > 3% |
| Email complaint rate | > 0.1% |
| Dispatch error rate by channel | > 5% over 15 min |

Notification logs record a **redacted** recipient (`pr****@example.com`, `+9198****3210`).
Full addresses are never written to application logs (doc 23 §11).

## 10. Business rules

| ID | Rule |
|---|---|
| BR-N1 | Domain events are written in the same transaction as the business change. |
| BR-N2 | Business logic never calls a notification provider directly. |
| BR-N3 | Delivery is at-least-once; `dedupe_key` makes duplicates harmless. |
| BR-N4 | Transactional notifications cannot be opted out of; marketing requires opt-in. |
| BR-N5 | A notification failure never fails or rolls back a business operation. |
| BR-N6 | Outbox payloads are self-contained; dispatch performs no database lookups. |
| BR-N7 | Every send is logged per channel with provider message id and status. |
| BR-N8 | Recipients are redacted in logs. |
| BR-N9 | Non-production environments use `NoopChannel` — **no real customer is ever contacted from staging.** |
| BR-N10 | Adding a channel must not require changes to order, subscription or payment code. |
