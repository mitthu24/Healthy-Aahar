# 32 — Edge Cases

Every case below has a defined behaviour. A case without a defined behaviour is a bug
waiting to be discovered by a customer. Cases marked ✅ have a required automated test
(doc 24 §3).

## A. Catalogue and cart

| ID | Scenario | Behaviour | Test |
|---|---|---|---|
| EC-C1 | Product deactivated while it sits in a cart | Cart returns an `ITEM_UNAVAILABLE` blocking issue; the line is shown struck through with a remove action. The cart is not silently emptied | ✅ |
| EC-C2 | Price changes while in a cart | Totals recompute on read; if it changes again during checkout, `409 PRICE_CHANGED` | ✅ |
| EC-C3 | Stock drops below the cart quantity | `ITEM_QUANTITY_REDUCED` warning, quantity clamped to available | ✅ |
| EC-C4 | Product hard-deleted while referenced | Cannot happen — catalogue entities are soft-deleted (`ON DELETE RESTRICT`) | ✅ |
| EC-C5 | Combo component goes out of stock | Combo becomes unavailable with the specific component named | ✅ |
| EC-C6 | Guest cart merged with an existing server cart | Quantities summed, clamped; unavailable items dropped and reported | ✅ |
| EC-C7 | Same merge payload sent twice | No double-counting — the client clears local storage only after a 200 | ✅ |
| EC-C8 | Quantity above `max_order_quantity` | Clamped with a warning, not an error | ✅ |
| EC-C9 | Cart untouched for 30 days | Deleted by the cleanup job; the customer sees an empty cart with a browse CTA | |
| EC-C10 | Search query of one character | `400 SEARCH_QUERY_TOO_SHORT` | ✅ |
| EC-C11 | Search typo ("chat" for "chaat") | Full-text finds nothing, `pg_trgm` fuzzy fallback matches, response says `match_type: FUZZY` | ✅ |

## B. Addresses and serviceability

| ID | Scenario | Behaviour | Test |
|---|---|---|---|
| EC-A1 | Unserviceable pincode entered | Address saves with `is_serviceable: false`; a waitlist prompt appears; checkout blocks later | ✅ |
| EC-A2 | Deleting an address used by an active subscription | `409 ADDRESS_IN_USE_BY_SUBSCRIPTION`, listing subscription numbers | ✅ |
| EC-A3 | Deleting an address used by a past order | Allowed — the order keeps its `address_snapshot` | ✅ |
| EC-A4 | Editing an address after an order was placed | The order is unaffected; it delivers to the snapshot | ✅ |
| EC-A5 | Deleting the default address | The next address becomes default; if none remain, `default_address_id` is null | |
| EC-A6 | Eleventh address | `409 ADDRESS_LIMIT_REACHED` | ✅ |
| EC-A7 | Zone boundaries change, making an address unserviceable | Re-resolved at checkout; active subscriptions are `SUSPENDED` with notification (BR-S15) | ✅ |

## C. Orders

| ID | Scenario | Behaviour | Test |
|---|---|---|---|
| EC-O1 | Two customers take the last slot simultaneously | Row lock serialises; one succeeds, one gets `409 SLOT_CAPACITY_EXCEEDED` | ✅ |
| EC-O2 | Cutoff passes mid-checkout | `409 SLOT_CUTOFF_PASSED`; the UI offers the next available slot | ✅ |
| EC-O3 | Double-tap on "Place order" | Idempotency key replays the first response | ✅ |
| EC-O4 | Network drop after the order committed | Retry with the same key returns the committed order | ✅ |
| EC-O5 | Same key, different body | `422 IDEMPOTENCY_KEY_REUSED` | ✅ |
| EC-O6 | Concurrent retry while the first is still running | `409 IDEMPOTENT_REQUEST_IN_PROGRESS`; client retries after a short delay | ✅ |
| EC-O7 | Customer cancels while an admin is advancing status | Row lock decides; the loser gets a `409` with the current state | ✅ |
| EC-O8 | Order cancelled after `PREPARING` | Admin only, reason required, stock written off as wastage, capacity released | ✅ |
| EC-O9 | Delivery fails (customer unreachable) | `FAILED`, payment `CANCELLED`, stock written off, customer notified, re-attempt allowed same day | ✅ |
| EC-O10 | Order still `OUT_FOR_DELIVERY` past its slot | Flagged on the exception list at 23:30; never auto-transitioned | |
| EC-O11 | COD not collected on a delivered order | Payment stays `DUE`; appears on the reconciliation report and exception list after 24h | |
| EC-O12 | Admin attempts an illegal transition | `409 INVALID_STATUS_TRANSITION` with the allowed set | ✅ |
| EC-O13 | Admin skips states (`CONFIRMED` → `READY_FOR_DISPATCH`) | Allowed; intermediate history rows are written | ✅ |
| EC-O14 | Order total does not match its lines | Impossible — `CHECK` constraint rejects the insert | ✅ |
| EC-O15 | Two orders placed in the same millisecond | Distinct `order_number` from the sequence; UUIDv7 ids remain unique | ✅ |

## D. Delivery slots

| ID | Scenario | Behaviour | Test |
|---|---|---|---|
| EC-D1 | Holiday declared for a date with existing orders | Orders are **not** auto-cancelled; admin sees a warning with the count and must act explicitly | ✅ |
| EC-D2 | Deleting a slot with future orders | `409 SLOT_IN_USE`; deactivate instead | ✅ |
| EC-D3 | Slot capacity reduced below current bookings | Rejected; existing orders are never invalidated by configuration | ✅ |
| EC-D4 | Address cached with a stale zone | Zone is re-resolved at checkout; the cache is advisory only | ✅ |
| EC-D5 | `roll-slot-capacity` fails overnight | P0 alert; materialisation and checkout fail loudly rather than silently over-booking; the job is idempotent and re-runnable | ✅ |
| EC-D6 | Slot deactivated while subscriptions use it | Existing deliveries are honoured; subscriptions flagged for reassignment | ✅ |
| EC-D7 | Customer's device clock is wrong | Irrelevant — cutoffs are computed server-side and returned as absolute UTC | ✅ |
| EC-D8 | Customer travelling in another timezone | Sees the same IST-derived labels the kitchen sees | ✅ |
| EC-D9 | Booking horizon reduced from 7 to 3 days | Existing orders beyond 3 days stand; new bookings are limited | |

## E. Subscriptions

Full treatment in [11-SUBSCRIPTION-ENGINE.md §8](11-SUBSCRIPTION-ENGINE.md).

| ID | Scenario | Behaviour | Test |
|---|---|---|---|
| EC-S1 | Pause after tomorrow's order was created | Order untouched, returned in `affected_orders[]`, cancelled only on explicit request | ✅ |
| EC-S2 | Slot full at materialisation | Retry hourly; past cutoff → `FAILED` + notify + exception list | ✅ |
| EC-S3 | Item out of stock at materialisation | Same path; `track_inventory=false` never blocks | ✅ |
| EC-S4 | Product deactivated mid-subscription | Materialisation fails → subscription `SUSPENDED`, admin notified | ✅ |
| EC-S5 | Slot deactivated mid-subscription | Flagged, then `SUSPENDED` with a prompt to choose a new slot | ✅ |
| EC-S6 | Catalogue price changes | Locked subscription price is unaffected; re-pricing is explicit and notified | ✅ |
| EC-S7 | Address in use deleted | Blocked (EC-A2) | ✅ |
| EC-S8 | Address becomes unserviceable | `SUSPENDED` + notification | ✅ |
| EC-S9 | Monthly on the 31st in a 30-day month | Clamps to the last day | ✅ |
| EC-S10 | `end_date` mid-window | Generation stops at `end_date`; status → `EXPIRED` after the final delivery | ✅ |
| EC-S11 | Generator runs twice concurrently | Unique constraint + advisory lock ⇒ no duplicates | ✅ |
| EC-S12 | Worker down for two days | Backfills from the watermark; imminent deliveries materialise immediately; past-cutoff ones become `FAILED` and surface | ✅ |
| EC-S13 | Duplicate subscription (same plan, slot, address, overlapping dates) | `409 DUPLICATE_SUBSCRIPTION`; genuinely different combinations are allowed | ✅ |
| EC-S14 | Holiday declared after deliveries exist | Future `SCHEDULED` cancelled with notification; `ORDER_CREATED` flagged for ops | ✅ |
| EC-S15 | Skip requested after materialisation | `409 ALREADY_MATERIALISED` with the order number and a link to cancel it | ✅ |
| EC-S16 | Pause limit exceeded | `422 PAUSE_LIMIT_EXCEEDED` with the remaining allowance | ✅ |
| EC-S17 | Cancel before `min_duration_days` | `409 MIN_DURATION_NOT_MET` with the earliest permitted date | ✅ |
| EC-S18 | Customer resumes a subscription paused three weeks ago | Regenerates from tomorrow; no backdated deliveries | ✅ |

## F. Inventory

| ID | Scenario | Behaviour | Test |
|---|---|---|---|
| EC-I1 | Two orders for the last unit | One succeeds, one gets `409 INSUFFICIENT_STOCK` | ✅ |
| EC-I2 | Stock adjusted below reserved quantity | Rejected — existing reservations are honoured; ops must cancel orders first | ✅ |
| EC-I3 | Item marked out of stock with orders already placed | Existing orders stand; new sales stop | ✅ |
| EC-I4 | Ledger sum does not equal on-hand | Nightly reconciliation alerts; indicates a write outside the service layer | ✅ |
| EC-I5 | Stock added after a subscription delivery failed for stock | The next hourly materialisation succeeds if still before cutoff | ✅ |
| EC-I6 | `track_inventory` switched off with reservations outstanding | Reservations are retained and released normally; new orders stop checking | |

## G. Identity and access

| ID | Scenario | Behaviour | Test |
|---|---|---|---|
| EC-U1 | Customer token used on an admin route | `401 WRONG_AUDIENCE` — the Firebase verifier rejects it | ✅ |
| EC-U2 | Account suspended while holding a valid token | `403 ACCOUNT_SUSPENDED` on the next request | ✅ |
| EC-U3 | Token expires mid-session | Client force-refreshes once and retries; a second failure signs out | ✅ |
| EC-U4 | Same phone signs in on two devices | Both work; Firebase supports concurrent sessions; one `users` row | ✅ |
| EC-U5 | Customer accesses another customer's order | `404`, not `403` | ✅ |
| EC-U6 | Last Super Admin demoted or deactivated | Rejected with an explanation | ✅ |
| EC-U7 | Admin edits their own roles | Rejected | ✅ |
| EC-U8 | Role permissions changed while the admin is signed in | Permission cache invalidated immediately; the next request uses the new set | ✅ |
| EC-U9 | Customer changes their phone number | Firebase re-verifies; `users.phone` updates only after verification | |
| EC-U10 | Deletion request with financial history | PII anonymised; orders retained with a tombstoned reference | |

## H. Notifications

| ID | Scenario | Behaviour | Test |
|---|---|---|---|
| EC-N1 | Brevo unavailable | Outbox retries with backoff; the order is unaffected; in-app notification still delivered | ✅ |
| EC-N2 | Outbox dispatched twice | `dedupe_key` prevents a duplicate send | ✅ |
| EC-N3 | Customer has no email | Email channel reports unavailable; in-app still delivered; not an error | ✅ |
| EC-N4 | Email hard-bounces | Marked invalid via webhook; future email sends suppressed; in-app continues | |
| EC-N5 | Event after 5 failed attempts | `DEAD` + alert + visible in the admin notification log for manual replay | ✅ |
| EC-N6 | Staging attempts a real send | Impossible — `NoopChannel` in every non-production environment | ✅ |

## I. Payments (COD now, gateway later)

| ID | Scenario | Behaviour | Test |
|---|---|---|---|
| EC-P1 | Cash short at delivery | Partial `amount_paid_paise`; the shortfall appears on reconciliation | |
| EC-P2 | Order cancelled before delivery | Payment `CANCELLED`; no refund needed | ✅ |
| EC-P3 | Refund requested on a COD order | Manual cash return or credit note, recorded in `refunds` | |
| EC-P4 | Duplicate webhook (P4) | Deduped on provider event id | ✅ |
| EC-P5 | Webhook arrives out of order (P4) | Validated against the state machine; no regression | ✅ |
| EC-P6 | Payment window expires (P4) | Order cancelled, slot capacity and stock released | ✅ |

## J. Platform

| ID | Scenario | Behaviour | Test |
|---|---|---|---|
| EC-X1 | Database unreachable | API returns `503 SERVICE_UNAVAILABLE`; marketing serves cached content; alert | |
| EC-X2 | API unreachable from marketing at build time | Last good static page served; the site never 500s for a catalogue outage | ✅ |
| EC-X3 | Worker not run in three hours | Dead-man's-switch alert (P0) | |
| EC-X4 | Deploy mid-transaction | Railway drains connections; in-flight transactions complete or roll back atomically | |
| EC-X5 | Migration fails on deploy | Deploy aborts; the previous version keeps serving; forward fix | |
| EC-X6 | Clock skew between API and database | All timestamps come from the database (`now()`) on the write path | |
| EC-X7 | Rate limit hit by a legitimate customer | `429` with `Retry-After`; the UI shows a friendly wait message rather than an error | ✅ |
| EC-X8 | Two API instances running (future scale-out) | All correctness invariants are database constraints, so horizontal scaling is safe. Only the in-process rate limiter needs Redis | |
