# 31 — Business Rules

The consolidated register of every rule the system enforces. Each rule has a stable id, the
document that specifies it in context, and where it is enforced. **Enforcement location
matters**: a rule enforced only in a UI is not enforced.

Legend — **DB**: database constraint · **Core**: domain/service layer · **API**: route
validation · **UI**: interface affordance only · **Job**: background worker.

## A. Catalogue

| ID | Rule | Enforced | Doc |
|---|---|---|---|
| BR-C1 | Category hierarchy is at most two levels deep | Core | 04 §5.1 |
| BR-C2 | The only purchasable unit is a product variant; products have no price | DB, Core | 04 §5.3 |
| BR-C3 | Every product has at least one variant, and exactly one default variant | DB (partial unique), Core | 04 §5.3 |
| BR-C4 | A line is purchasable only if product `ACTIVE` **and** variant `AVAILABLE` **and** stock sufficient | Core | 13 §2 |
| BR-C5 | `mrp_paise >= price_paise`; discounts can never be negative | DB CHECK | 04 §5.3 |
| BR-C6 | `subscription_price_paise <= price_paise` | DB CHECK | 04 §5.3 |
| BR-C7 | `cost_paise` is never serialised on a public or customer endpoint | Core (DTO layer) | 06 §4 |
| BR-C8 | Product slugs are immutable after publishing; renames create a 301 | Core | 21 §5 |
| BR-C9 | Publishing requires at least one variant and one `READY` image | Core | 15 §5 |
| BR-C10 | Alt text is mandatory on every product image | API | 04 §5.4 |

## B. Combos

| ID | Rule | Enforced | Doc |
|---|---|---|---|
| BR-B1 | A combo contains at least two component variants | Core | 12 §8 |
| BR-B2 | Combo components are variants, never products | DB FK | 12 §8 |
| BR-B3 | A combo is available only if every component is available in the required quantity | Core | 12 §4 |
| BR-B4 | Combo availability is derived, never stored | Core | 12 §4 |
| BR-B5 | An order stores one priced parent line plus N zero-priced component lines | Core | 12 §2 |
| BR-B6 | If combo price ≥ component sum, no savings badge is shown and admin is warned | Core, UI | 12 §3 |
| BR-B7 | Inventory is reserved, consumed and released at component level | Core | 12 §5 |
| BR-B8 | Combo composition and price changes never alter existing orders or subscriptions | Core (snapshots) | 12 §7 |
| BR-B9 | A combo has no inventory row of its own | Design | 12 §5 |
| BR-B10 | A combo may not contain another combo | Core | 12 §8 |

## C. Cart and checkout

| ID | Rule | Enforced | Doc |
|---|---|---|---|
| BR-K1 | One active cart per customer | DB unique | 04 §7.1 |
| BR-K2 | Cart totals are never stored; they are recomputed from live catalogue data on every read | Core | 04 §7.1 |
| BR-K3 | Adding an existing line increments quantity rather than duplicating it | DB unique, Core | 04 §7.2 |
| BR-K4 | Quantity is clamped to `max_order_quantity` and to available stock | Core | 06 §6 |
| BR-K5 | Checkout is blocked while any `BLOCKING` cart issue exists | Core, UI | 06 §6 |
| BR-K6 | `expected_total_paise` must match the server total, or the order fails with `PRICE_CHANGED` | Core | 06 §8 |
| BR-K7 | Order placement requires an `Idempotency-Key`; replay returns the original response | Core, DB unique | 04 §7.6 |
| BR-K8 | Guest carts are merged server-side on login, summing quantities and dropping unavailable items | Core | 06 §6 |
| BR-K9 | Carts reserve no stock and no slot capacity | Design | 13 §3 |

## D. Delivery, slots and zones

| ID | Rule | Enforced | Doc |
|---|---|---|---|
| BR-D1 | Serviceability is enforced once, at checkout; unserviceable addresses may still be saved | Core | 10 §7 |
| BR-D2 | A pincode is assigned to at most one delivery zone (PHASE 06). Zone assignment narrows, never widens, city/pincode serviceability — see BR-SV8 | DB unique | 04 §6.3 |
| BR-D3 | `cutoff_at = (service_date − cutoff_days_before) @ cutoff_time` in the business timezone | Core | 10 §4 |
| BR-D4 | Orders cannot be placed after `cutoff_at` | Core | 10 §5 |
| BR-D5 | A slot is bookable on a date only if that ISO weekday is in `available_days` | Core | 10 §5 |
| BR-D6 | `booked_count` may never exceed `capacity` | **DB CHECK** + row lock | 10 §6.2 |
| BR-D7 | One order consumes one unit of capacity, regardless of item count | Core | 10 §6.3 |
| BR-D8 | Holidays and blackouts suppress both new orders and subscription generation | Core, Job | 10 §8 |
| BR-D9 | Slot-level fee and minimum override zone-level values when set | Core | 10 §7 |
| BR-D10 | Cancellation releases slot capacity at any stage | Core | 10 §6.4 |
| BR-D11 | A slot with future orders or active subscriptions cannot be deleted, only deactivated | Core | 10 §12 |
| BR-D12 | Changing `default_capacity` affects future capacity rows only | Job | 10 §11 |
| BR-D13 | A date's capacity cannot be reduced below its current `booked_count` | Core | 10 §11 |
| BR-D14 | Slot windows may not cross midnight | DB CHECK | 04 §6.3 |

## D0. Serviceability — cities and pincodes **[PHASE 01]**

The rules that make expansion an admin action rather than a deploy (ADR-023, ADR-024).

| ID | Rule | Enforced | Doc |
|---|---|---|---|
| BR-SV1 | Serviceability is resolved from the database on every request. No city list, pincode list or `if (city === ...)` exists anywhere in application code, and no client-supplied serviceability flag is ever read | Core, review, CI grep | 04 §6.4 |
| BR-SV2 | A pincode belongs to exactly one city per business | **DB unique** | 04 §6.3 |
| BR-SV3 | A pincode and its city must belong to the same business | **DB composite FK** | 04 §6.3 |
| BR-SV4 | A city may be activated only if it has at least one ACTIVE pincode, otherwise it would appear serviceable while accepting no addresses | Core | 04 §6.4 |
| BR-SV5 | Deactivating a city or pincode requires a reason and is audited. Status is changed only through explicit activate/deactivate endpoints, never by including `status` in a create or update body | API, Core | 06 |
| BR-SV6 | Switching a city or pincode off **never** deletes customers, addresses, orders or subscriptions. It only prevents *new* serviceability. Historical records keep resolving to their original city | Design | 04 §6.2 |
| BR-SV7 | Bootstrap slot templates in `settings` are seed data only. No runtime code reads slot times from `settings`; `delivery_slots` is the sole source from PHASE 06 | Review | ADR-026 |
| BR-SV8 | Zone and slot checks (PHASE 06) may only **narrow** city/pincode serviceability, never widen it. A zone cannot make an inactive pincode serviceable | Core | 04 §6.4 |
| BR-SV9 | The city gate is evaluated before the pincode gate, so deactivating a city is sufficient on its own and overrides any pincode left ACTIVE beneath it | Core | 04 §6.4 |
| BR-SV10 | An ACTIVE city or pincode must record `activated_at` | **DB CHECK** | 04 §6.2 |
| BR-SV11 | A non-serviceable pincode is answered with HTTP 200 and `is_serviceable: false`, never a 404 — the question was answered successfully | API | 06 §4 |
| BR-SV12 | Serviceability is re-verified at checkout against live data, never trusted from a saved address or a client payload | Core | 04 §6.4 |

## E. Orders

| ID | Rule | Enforced | Doc |
|---|---|---|---|
| BR-O1 | Order status describes fulfilment; payment status describes money. They are independent | Design | 09 §1 |
| BR-O2 | An order cannot be placed for a slot past its cutoff | Core | 09 §5 |
| BR-O3 | `PENDING` orders auto-confirm when the slot cutoff passes | Job | 09 §5 |
| BR-O4 | A customer may cancel only while `PENDING`/`CONFIRMED` and before `cutoff_at` | Core | 09 §3 |
| BR-O5 | After `PREPARING`, only an admin may cancel, with a mandatory reason | Core | 09 §3 |
| BR-O6 | Cancellation before `PREPARING` releases stock; at or after, it is written off as wastage | Core | 09 §5 |
| BR-O7 | Cancellation always decrements `slot_capacity.booked_count` | Core | 09 §5 |
| BR-O8 | Order totals are immutable after placement; corrections are refunds, never edits | Core | 09 §5 |
| BR-O9 | `order_number` comes from a sequence and is never reused | DB sequence | 04 §7.3 |
| BR-O10 | Every transition writes an `order_status_history` row in the same transaction | Core | 09 §5 |
| BR-O11 | COD moves to `PAID` only on `DELIVERED`, recording the collector | Core | 19 §5.1 |
| BR-O12 | A `FAILED` order may be re-attempted on the same `service_date` only | Core | 09 §5 |
| BR-O13 | An admin may change an order's slot or date only while `PENDING`/`CONFIRMED`, moving capacity atomically | Core | 09 §5 |
| BR-O14 | Subscription orders follow exactly the same state machine | Design | 09 §6 |
| BR-O15 | Transitions not in the transition table are rejected; there is no force-status override | Core | 09 §3 |

## F. Subscriptions

| ID | Rule | Enforced | Doc |
|---|---|---|---|
| BR-S1 | A subscription has one customer, one slot and one address at a time | DB FK | 11 §7 |
| BR-S2 | `start_date` ≥ tomorrow and ≤ today + 60 days | API, Core | 11 §7 |
| BR-S3 | `delivery_days` must be a subset of the plan's `allowed_days` | Core | 11 §7 |
| BR-S4 | Deliveries are generated only while the subscription is `ACTIVE` | Job | 11 §4.1 |
| BR-S5 | A delivery is skippable only while `SCHEDULED` and before that date's cutoff | Core | 11 §6.3 |
| BR-S6 | Pausing cancels future `SCHEDULED` deliveries but never already-created orders | Core | 11 §6.2 |
| BR-S7 | Subscription price is locked at subscription time; re-pricing is explicit and notified | Core | 11 §7 |
| BR-S8 | Subscription orders consume slot capacity on the same terms as one-time orders | Core | 11 §4.2 |
| BR-S9 | **Exactly one delivery per (subscription, date); exactly one order per delivery** | **DB unique ×2** | 11 §5 |
| BR-S10 | Subscription orders use the ordinary order lifecycle | Design | 09 §6 |
| BR-S11 | Cancelling a subscription order cancels that delivery, not the subscription | Core | 11 §7 |
| BR-S12 | `min_duration_days` blocks early cancellation | Core | 11 §6.6 |
| BR-S13 | Holidays suppress generation for those dates | Job | 11 §7 |
| BR-S14 | Changes apply from the next un-materialised delivery; `effective_from_date` is returned | Core | 11 §6.5 |
| BR-S15 | A subscription whose address becomes unserviceable is `SUSPENDED`, not cancelled | Job | 11 §7 |
| BR-S16 | Skip and pause limits are counted per calendar month | Core | 11 §7 |
| BR-S17 | Generation is a watermark extension, making the job idempotent | Job, DB unique | 11 §4.1 |

## G. Inventory

| ID | Rule | Enforced | Doc |
|---|---|---|---|
| BR-I1 | Inventory attaches to variants only | DB | 13 §2 |
| BR-I2 | Carts never reserve stock; orders do | Design | 13 §3 |
| BR-I3 | Reservation happens inside the order transaction | Core | 13 §3 |
| BR-I4 | Consumption happens at `PREPARING` | Core | 13 §3 |
| BR-I5 | Cancellation before `PREPARING` releases; at or after, writes off as wastage | Core | 13 §3 |
| BR-I6 | `quantity_available` is always derived, never stored | Design | 13 §2 |
| BR-I7 | Every inventory change writes a movement in the same transaction | Core | 13 §4 |
| BR-I8 | Every manual adjustment requires a reason | API | 13 §4 |
| BR-I9 | `track_inventory = false` never blocks a sale | Core | 13 §2 |
| BR-I10 | Stock may not go negative unless `allow_backorder` is set | **DB CHECK** | 13 §5 |
| BR-I11 | Combo stock is component stock | Design | 13 §2 |
| BR-I12 | A stock change never retroactively alters a placed order | Design | 13 §7 |
| BR-I13 | Marking a variant out of stock stops new sales but does not cancel existing orders | Core | 13 §7 |

## H. Payments

| ID | Rule | Enforced | Doc |
|---|---|---|---|
| BR-P1 | Every order has exactly one `payments` row, including COD | DB unique | 19 §11 |
| BR-P2 | Payment status and order status are independent | Design | 19 §3 |
| BR-P3 | Business logic talks to `PaymentGateway`, never to a provider SDK | Design, review | 19 §4 |
| BR-P4 | COD moves to `PAID` only on `DELIVERED` | Core | 19 §5.1 |
| BR-P5 | Cancellation before delivery sets payment `CANCELLED`, not `REFUNDED` | Core | 19 §5.1 |
| BR-P6 | Refunds never exceed the amount paid | DB CHECK, Core | 19 §8 |
| BR-P7 | Webhooks are signature-verified on the raw body, persisted, then deduped by event id | Core | 19 §6 |
| BR-P8 | Card and credential data is never stored or logged | Design | 19 §7 |
| BR-P9 | All amounts are integer paise | DB type | 04 §1.2 |
| BR-P10 | Slot capacity and inventory are held during an online payment window and released on expiry | Core, Job | 19 §5.2 |
| BR-P11 | No code outside the gateway registry branches on `provider` | Review | 19 §11 |

## I. Notifications

| ID | Rule | Enforced | Doc |
|---|---|---|---|
| BR-N1 | Domain events are written in the same transaction as the business change | Core | 18 §2 |
| BR-N2 | Business logic never calls a notification provider directly | Design | 18 §3 |
| BR-N3 | Delivery is at-least-once; `dedupe_key` makes duplicates harmless | DB unique | 18 §2 |
| BR-N4 | Transactional notifications cannot be opted out of; marketing requires opt-in | Core | 18 §5 |
| BR-N5 | A notification failure never fails a business operation | Design | 18 §2 |
| BR-N6 | Outbox payloads are self-contained; dispatch performs no lookups | Core | 18 §2 |
| BR-N7 | Every send is logged per channel with provider id and status | Core | 18 §9 |
| BR-N8 | Recipients are redacted in logs | Core | 18 §9 |
| BR-N9 | Non-production uses `NoopChannel`; no real customer is contacted from staging | Config, test | 18 §10 |
| BR-N10 | Adding a channel must not require changes to order or subscription code | Design | 18 §10 |

## J. Security and access

| ID | Rule | Enforced | Doc |
|---|---|---|---|
| BR-SEC1 | Customer and admin identities live in separate Firebase projects | Config | 07 §2 |
| BR-SEC2 | Firebase performs authentication only; authorization is ours | Design | 07 §1 |
| BR-SEC3 | `users.status` is checked on every request; suspension is effective immediately | Core | 07 §6 |
| BR-SEC4 | Customer resource access is enforced by ownership in the SQL `WHERE` clause | Core | 23 §4 |
| BR-SEC5 | A resource not owned by the caller returns `404`, not `403` | Core | 06 §1.6 |
| BR-SEC6 | At least one active Super Admin must always exist | Core | 08 §6 |
| BR-SEC7 | Only a Super Admin may grant `roles:manage` or create a Super Admin | Core | 08 §6 |
| BR-SEC8 | An admin cannot modify their own roles | Core | 08 §6 |
| BR-SEC9 | System roles cannot be deleted or renamed | DB flag, Core | 08 §6 |
| BR-SEC10 | Deactivating an admin revokes their Firebase refresh tokens | Core | 08 §6 |
| BR-SEC11 | Unmasking customer PII requires a reason and is audited | API, Core | 08 §6 |
| BR-SEC12 | Every `ADMIN`-audience route declares a permission; the registry asserts this at boot | Core | 23 §4 |
| BR-SEC13 | Every admin mutation writes an `audit_logs` row in the same transaction | Core | 23 §12 |
| BR-SEC14 | `audit_logs` is append-only by database grant | **DB grant** | 23 §11 |
| BR-SEC15 | No PII in application logs, URLs or analytics events | Core | 23 §11 |
| BR-SEC16 | No secret in the repository | CI (Gitleaks) | 23 §10 |
| BR-SEC17 | Upload keys are server-generated; content type and size are enforced in the presign | Core | 23 §9 |
| BR-SEC18 | Uploaded images are validated by magic bytes and stripped of EXIF before being served | Job | 23 §9 |

## K. Platform and process

| ID | Rule | Enforced | Doc |
|---|---|---|---|
| BR-ENV1 | Every service validates its environment at boot and refuses to start if invalid | Core | 27 §2 |
| BR-ENV2 | Behaviour branches on `APP_ENV`, never `NODE_ENV` | Core | 27 §1 |
| BR-ENV3 | Non-production never sends real email, SMS or WhatsApp | Config, test | 27 §8 |
| BR-ENV4 | No production credential exists in any non-production environment | Process | 27 §8 |
| BR-ENV5 | `NEXT_PUBLIC_*` is public by definition | CI | 27 §2 |
| BR-MK1 | The marketing site shows only `ACTIVE` catalogue entities, fetched from the API | Core | 16 §10 |
| BR-MK2 | Publicly displayed slot windows are read from the API, never hard-coded | Core | 16 §10 |
| BR-MK3 | Public prices equal API prices at revalidation time | Core | 16 §10 |
| BR-MK4 | The marketing site never writes business data | Design | 16 §10 |
| BR-MK5 | No authenticated content is rendered on `maindomain.com` | Design | 16 §10 |
| BR-SEO1 | Only `maindomain.com` is indexable | Config ×2 | 21 §10 |
| BR-SEO2 | Structured data is generated from live API data | Core | 21 §10 |
| BR-DEP1 | Every migration is backward-compatible with the currently running code | Review | 25 §8 |
| BR-DEP2 | Migrations and the API deploy before the frontends | CI | 25 §7 |
| BR-DEP3 | Destructive schema changes use expand/contract across releases | Review | 25 §8 |

## Cross-cutting invariants

Five statements that must hold at all times. Each is enforced by a database constraint, not
only by code, and each has a dedicated concurrency test (doc 24 §5).

1. `slot_capacity.booked_count <= capacity` — no over-booking.
2. `inventory.quantity_on_hand >= 0` — no negative stock.
3. One `subscription_deliveries` row per `(subscription_id, delivery_date)`.
4. One `orders` row per `subscription_delivery_id`.
5. `orders.total_paise = subtotal − discount + delivery_fee + tax` — the invoice always adds up.
