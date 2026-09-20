# 20 — WhatsApp Integration (Future — Phase 5)

**Not implemented at MVP.** This document exists so that the MVP is built in a way that
makes WhatsApp additive. It records where the integration plugs in and what must already be
true for that to work.

## 1. Why WhatsApp matters for this business

In India, WhatsApp open rates run far ahead of email, and the daily rhythm of a subscription
product — "your bowl arrives tomorrow at 6 AM, reply SKIP to skip" — fits conversational
messaging far better than an inbox. For persona P1, who never opens the app after week one,
WhatsApp *is* the interface.

## 2. Where it plugs in

**Outbound: nowhere new.** WhatsApp is a `NotificationChannel` implementation
(doc 18 §3). It is registered in the channel registry, enabled per event in `routing.ts`,
and the dispatcher does the rest.

```
order/subscription code   →  notification_outbox   →  dispatcher
                                                         ├── InAppChannel      (MVP)
                                                         ├── BrevoEmailChannel (MVP)
                                                         └── WhatsAppChannel   (P5)  ← added here
```

**Inbound: one new webhook and one new module.** `POST /v1/webhooks/whatsapp` verifies the
provider signature, stores the message, and hands it to a conversation handler that maps an
intent to an **existing API use case** in `packages/core`. It does not reimplement business
logic; "skip tomorrow" from WhatsApp calls the same `skipDelivery` service the app calls, so
the rules, limits and audit trail are identical by construction.

## 3. Prerequisites already satisfied by the MVP

| Requirement | Already in place |
|---|---|
| Verified E.164 phone per customer | `users.phone`, verified by Firebase OTP |
| Event stream to subscribe to | `notification_outbox` |
| Channel abstraction | `NotificationChannel` |
| Per-channel delivery log | `notification_logs.channel` |
| Consent storage | `notification_preferences` (channel × category) |
| Webhook handling pattern | Raw-body verification, persist-then-process, dedupe (doc 19 §6) |
| Business operations callable without HTTP | `packages/core` services |
| Idempotency for actions | `idempotency_keys` |

Nothing on this list would need to be retrofitted. That is the entire point of writing this
document during Phase 00.

## 4. Provider choice (decide at Phase 5)

| Option | Notes |
|---|---|
| **Meta WhatsApp Cloud API** (likely) | Direct, lowest per-message cost, official; requires managing template approval and hosting the webhook ourselves |
| AiSensy / Interakt / WATI | India-focused BSPs with a template UI and campaign tooling; higher per-message cost, faster to launch, better for non-technical campaign work |
| Twilio | Excellent DX and reliability; more expensive; adds a vendor |

**Provisional recommendation:** start with a BSP for template management and campaign UX,
behind our `WhatsAppChannel` adapter so that moving to the Cloud API later is one file.
Recorded as `PENDING` in doc 36.

## 5. Outbound messages

WhatsApp requires pre-approved templates for business-initiated messages outside a 24-hour
customer-service window. Templates map 1:1 to the events in doc 18 §4.

| Template | Event | Category |
|---|---|---|
| `order_confirmed` | `ORDER_PLACED` | Utility |
| `order_out_for_delivery` | `ORDER_OUT_FOR_DELIVERY` | Utility |
| `order_delivered` | `ORDER_DELIVERED` | Utility |
| `order_cancelled` | `ORDER_CANCELLED` | Utility |
| `delivery_reminder` | `SUBSCRIPTION_DELIVERY_REMINDER` | Utility — **the highest-value message** |
| `subscription_confirmed` | `SUBSCRIPTION_CREATED` | Utility |
| `subscription_paused` / `_resumed` | matching events | Utility |
| `subscription_suspended` | `SUBSCRIPTION_SUSPENDED` | Utility |
| `delivery_failed` | `SUBSCRIPTION_DELIVERY_FAILED` | Utility |
| `promo_*` | campaigns | **Marketing — opt-in only** |

Example, with quick-reply buttons:

> *Good evening, Priya 👋*
> Your **Fruit Chaat Bowl** arrives tomorrow, **22 Sep, 6:00–8:00 AM**.
> Skip this delivery until 10:00 PM tonight.
> `[ Skip tomorrow ]  [ View order ]  [ Manage plan ]`

## 6. Inbound automation

```
customer message → /v1/webhooks/whatsapp
  → verify signature (raw body) → persist → dedupe on provider message id
  → resolve customer by E.164 phone → users → customer_profile
  → intent (button payload, or keyword, or a small classifier)
  → call the existing core service
  → reply via WhatsAppChannel
```

| Intent | Core service | Notes |
|---|---|---|
| `SKIP_TOMORROW` | `skipDelivery` | Same limits, same cutoff, same audit |
| `PAUSE` | `pauseSubscription` | Asks for a resume date |
| `RESUME` | `resumeSubscription` | |
| `TRACK_ORDER` | `getOrderStatus` | |
| `REORDER` | `createOrderFromPastOrder` | Confirmation required before placing |
| `HELP` | — | Hands off to a human |
| Unrecognised | — | Hands off to a human; never guesses |

**Identity rule:** the sender's WhatsApp number must exactly match a verified
`users.phone`. If it does not, the bot replies with a sign-in link and takes **no action on
any account**. A phone number arriving in a webhook is a claim, not proof, and no
account-affecting operation is performed on that basis alone.

**Confirmation rule:** anything that creates an order or spends money requires an explicit
confirmation turn. Skipping and pausing are reversible and may be single-turn.

## 7. Consent and compliance

- Opt-in is explicit and recorded in `notification_preferences` with a timestamp and source.
- Utility templates (order and subscription updates) require opt-in at sign-up; marketing
  requires separate, granular opt-in.
- Every message includes a stop instruction; `STOP` disables the channel immediately and
  writes the preference change with an audit entry.
- Marketing sends respect quiet hours (no sends 21:00–08:00 IST).
- Message content is redacted in logs, as with every channel (doc 18 §9).

## 8. Implementation checklist (Phase 5)

1. Choose a provider; register the business, verify the number, get templates approved.
2. `packages/notifications/src/channels/whatsapp.ts` implementing `NotificationChannel`.
3. Register the channel; enable per-event routing in `routing.ts`.
4. Add `WHATSAPP` opt-in to the profile UI and sign-up flow.
5. `POST /v1/webhooks/whatsapp` with signature verification and dedupe.
6. `packages/core/src/conversation/` — intent resolution and dialogue state.
7. Admin: WhatsApp message log per customer, plus template status.
8. Tests: template rendering, inbound intents, identity mismatch, opt-out, dedupe,
   rate limits.
9. Monitoring: delivery rate, read rate, failure codes, inbound volume, handoff rate.

**What this list does not contain:** any change to order, subscription, slot, inventory or
payment logic. If Phase 5 finds itself editing those files, the abstraction failed and that
is a design bug to fix rather than work around.

## 9. Explicit non-goals

- WhatsApp as the primary ordering channel (browsing food needs images and a catalogue).
- A general-purpose LLM support agent without human handoff.
- Sending marketing without granular opt-in.
- Any account action based on an unverified phone number.
