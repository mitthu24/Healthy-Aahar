# 37 — Glossary

Shared vocabulary. When these words are used in code, in tickets or in conversation, they
mean exactly this and nothing else.

## Domain

**Availability** — an *editorial* decision that a variant is or is not being sold
(`product_variants.availability`). Distinct from **stock**, which is quantitative. Both must
pass for a line to be purchasable.

**Blackout** — a single (slot, zone, date) closed ad hoc via `slot_capacity.is_blocked`.
Compare **holiday**, which is planned and may be broader.

**Booking horizon** — how many days ahead a customer may place a one-time order
(`settings.booking.horizon_days`, default 7).

**Combo** — a bundle of ≥ 2 product variants sold as one priced line. Has no stock of its
own; its availability is derived from its components.

**Component (order line)** — a zero-priced `order_items` row representing one variant inside
a combo, used for inventory and prep. Carries `is_component = true`.

**Cutoff** — the last instant an order may be placed for a given slot and service date.
Computed as `(service_date − cutoff_days_before) @ cutoff_time` in the business timezone.

**Delivery (subscription)** — one dated occurrence of a subscription
(`subscription_deliveries`). It may be skipped and may never become an order. **Not** the
physical act of delivering.

**Generation horizon** — how far ahead subscription deliveries are planned
(default 14 days). Longer than the booking horizon so customers can see their schedule.

**Holiday** — a planned non-delivery date, optionally scoped to a zone or slot
(`business_holidays`).

**Materialisation** — the act of turning a `SCHEDULED` subscription delivery into a real
order. Happens within the materialise horizon (default 36 hours).

**MRP** — maximum retail price, the printed price used for "you saved" display. Never the
charged price.

**Paise** — 1/100 of a rupee. All money is stored as integer paise.

**Parent (order line)** — the priced `order_items` row for a combo (`is_component = false`).
Only parents contribute to the subtotal.

**Pincode** — a six-digit Indian postal code. Maps to exactly one delivery zone.

**Plan (subscription plan)** — the admin-authored *offer*. Distinct from a **subscription**,
which is a customer's contract instantiated from a plan.

**Prep list** — quantities per variant required for a date and slot, aggregating one-time and
subscription orders. What the kitchen works from.

**Dispatch manifest** — orders grouped by slot and zone with addresses and COD amounts. What
the delivery run works from.

**Product** — the marketing and informational entity. **Not purchasable and has no price.**

**Reserved stock** — quantity promised to placed orders that have not yet been prepared.
`available = on_hand − reserved`.

**Service date** — the calendar date of delivery, stored as a bare `DATE` in `Asia/Kolkata`.

**Serviceability** — whether a pincode falls inside an active delivery zone.

**Skip** — cancelling one subscription delivery while keeping the subscription active.
Distinct from **pause**, which covers a date range, and **cancel**, which is terminal.

**Slot** — a recurring delivery window rule (name, start, end, cutoff, days, capacity).
Distinct from **slot capacity**, which is one concrete bookable date for a slot in a zone.

**Snapshot** — a copy of a mutable value (price, name, address, slot window) stored on an
order or delivery so history cannot be rewritten by a later edit.

**Subscription** — a customer's standing contract that generates deliveries over time.

**Variant** — **the only purchasable unit.** Carries SKU, price, tax rate, availability and
stock. Every cart line, order line, combo item and subscription item resolves to a variant.

**Wastage** — stock consumed without revenue: cancelled after preparation, failed delivery,
or spoilage.

**Zone** — a delivery area defined by a set of pincodes, with its own fee, minimum order and
slot assignments.

## Technical

**Actor** — the resolved identity of a request: `CUSTOMER`, `ADMIN`, `SYSTEM` or `ANONYMOUS`.
Handlers receive an `Actor`; they never read tokens.

**ADR** — Architecture Decision Record. See doc 36.

**Audience** — which identity population a route serves (`public`, `me`, `admin`,
`internal`). Declared per route; enforced in middleware.

**Cursor pagination** — pagination by an opaque encoded sort key rather than an offset.
Stable under concurrent writes.

**Dead-man's switch** — an alert that fires when an expected event *has not* happened, such
as a job not running.

**Dedupe key** — a unique value on an outbox event preventing duplicate notification sends.

**Derived field** — computed on read, never stored (`quantity_available`, combo availability,
cart totals). Stored copies can disagree with their sources; derived values cannot.

**Expand/contract** — a two-or-three-release pattern for destructive schema changes: add,
backfill and dual-write; switch reads; drop later.

**Idempotency key** — a client-supplied value making a retried unsafe request safe.

**ISR** — Incremental Static Regeneration. Static pages revalidated on a timer or on demand.

**LQIP** — Low Quality Image Placeholder, a tiny blurred base64 preview preventing layout
shift.

**Outbox** — a database table written in the same transaction as a business change, dispatched
asynchronously. Guarantees "if it committed, it will be sent".

**Port / adapter** — an interface (`PaymentGateway`, `NotificationChannel`, `StoragePort`)
and its implementations. Business logic depends on the port, never the implementation.

**Presigned URL** — a time-limited, constraint-bound URL allowing a browser to upload
directly to object storage without the bytes passing through our API.

**RSC** — React Server Component; rendered on the server, ships no JavaScript to the client.

**SKIP LOCKED** — a PostgreSQL clause letting concurrent workers claim different rows without
blocking each other. Used by the outbox dispatcher.

**Soft delete** — marking `deleted_at` instead of removing a row, used only where history
must survive removal (doc 04 §1.4).

**Watermark** — `subscriptions.generated_until_date`; how far ahead deliveries have been
generated. Makes generation idempotent by expressing it as "extend to" rather than
"create N".

## Status values

**Order:** `PENDING` → `CONFIRMED` → `PREPARING` → `READY_FOR_DISPATCH` →
`OUT_FOR_DELIVERY` → `DELIVERED`; plus `CANCELLED`, `FAILED`, `RETURNED`.

**Payment:** `DUE` · `AUTHORIZED` · `PAID` · `PARTIALLY_REFUNDED` · `REFUNDED` · `FAILED` ·
`CANCELLED`.

**Subscription:** `ACTIVE` · `PAUSED` · `SUSPENDED` · `CANCELLED` · `EXPIRED`.

**Subscription delivery:** `SCHEDULED` · `SKIPPED` · `ORDER_CREATED` · `FULFILLED` ·
`FAILED` · `CANCELLED`.

**Product:** `DRAFT` · `ACTIVE` · `INACTIVE` · `ARCHIVED`.

**Account:** `ACTIVE` · `SUSPENDED` · `DEACTIVATED`.

## Reference prefixes

| Prefix | Meaning | Defined in |
|---|---|---|
| `FR-*` | Functional requirement | doc 01 |
| `NFR-*` | Non-functional requirement | doc 01 |
| `BR-*` | Business rule | doc 31 |
| `EC-*` | Edge case | doc 32 |
| `ADR-*` | Architecture decision | doc 36 |
| `PD-*` | Pending decision | doc 36 |
| `G*` / `P*` | Business goal / persona | doc 01 |

## Words we avoid

| Avoid | Use instead | Why |
|---|---|---|
| "Item" (unqualified) | variant, cart item, order item, combo component | Ambiguous across four entities |
| "Subscription order" as a distinct type | an order with `source = 'SUBSCRIPTION'` | It is an ordinary order (BR-O14) |
| "Delivery" for the physical act | dispatch, or "the delivery run" | `subscription_deliveries` owns the word |
| "User" for a customer | customer (business) or user (identity) | Two different tables |
| "Price" without qualification | `price_paise`, `mrp_paise`, `subscription_price_paise` | Three different numbers |
| "Available" without qualification | availability (editorial) or in stock (quantitative) | Two different checks |
