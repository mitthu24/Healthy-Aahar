# 01 — Product Requirements Document

## 1. Product summary

**Healthly** (working name) is a quick-commerce platform for **fresh, healthy, ready-to-eat food**:
fresh fruit, fresh-cut fruit and vegetables, fruit chaat, salads, sprouts, healthy breakfast
items, healthy snacks, and curated combos — sold both as **one-time orders** and as
**recurring subscriptions** delivered in fixed daily slots.

We are not a 10-minute dark-store general grocer. We are a **scheduled-slot fresh food
service**: the customer orders before a cutoff, we prepare fresh that morning/evening, we
deliver inside a predictable window. Subscriptions are the primary retention and margin
engine; one-time orders are the acquisition funnel.

### 1.1 Positioning statement

> For health-conscious urban professionals and families who want fresh fruit and healthy
> prepared food without the daily effort of buying, washing, cutting and preparing it,
> **Healthly** is a subscription-first fresh food delivery service that delivers freshly
> prepared bowls and cut produce in a guaranteed morning or evening slot. Unlike
> instant-delivery grocers, we prepare after you order, which means genuinely fresh,
> genuinely healthy, and genuinely on time.

### 1.2 Why this is not "another Blinkit"

| Dimension | Instant grocery (Blinkit/Zepto) | Healthly |
|---|---|---|
| Promise | 10 minutes, anything | Fresh-prepared, predictable slot |
| Catalogue | 10,000+ SKUs | 60–200 curated SKUs |
| Inventory | Pre-stocked, shelf-stable | Prepared-to-order, perishable, same-day |
| Core unit | Impulse basket | Recurring subscription |
| Fulfilment trigger | Order → pick from shelf | Order → cutoff → batch prep → slot dispatch |
| Repeat driver | Convenience | Habit + health outcome |

This difference is **architectural**, not cosmetic: it is why the system is built around
**delivery slots with capacity and cutoffs** and a **subscription scheduler**, rather than
around real-time dark-store inventory.

## 2. Goals

### 2.1 Business goals

| ID | Goal | Measure |
|---|---|---|
| G1 | Launch a sellable storefront in one city/zone | MVP live, first 100 real orders |
| G2 | Make subscriptions the default purchase mode | ≥ 35% of monthly revenue from subscriptions by month 3 |
| G3 | Operate reliably without a large ops team | 1 ops person can run a day of fulfilment from the admin panel |
| G4 | Keep per-order fulfilment predictable | ≥ 95% of orders delivered inside the promised slot |
| G5 | Be ready to add payments, WhatsApp and mobile apps without redesign | Each added in ≤ 1 phase, no schema rewrite |

### 2.2 Product goals

- Customer can go from landing page to placed order in **under 90 seconds** on mobile.
- Customer can create a daily subscription in **under 60 seconds**.
- Admin can see what must be prepared and dispatched today in **one screen**.
- The system never silently double-charges, double-delivers, or over-books a slot.

### 2.3 Explicit non-goals (MVP)

- Online payment collection (architecture is ready; integration is Phase 4).
- Multi-city / multi-dark-store operations (schema is ready; UI is Phase 3).
- Rider/delivery-partner mobile app and live GPS tracking.
- Loyalty points, referrals, wallets, gift cards.
- Marketplace / third-party sellers.
- Native mobile apps (API is ready; apps are Phase 6).

## 3. Users and personas

### P1 — "Priya", the routine buyer (primary, subscription target)

32, working professional, wants a fruit bowl at her desk every weekday morning. Values
consistency over variety. Will set up one subscription and expect it to just work. Cares
about: pause when travelling, skip on a holiday, change slot occasionally.
**Success =** she never has to open the app after week one, except to pause.

### P2 — "Arjun", the health-goal buyer (primary, one-time to subscription)

26, gym-going, buys protein salads and sprouts. Browses nutrition and calories. Price
sensitive on combos. Discovers via the marketing site and social.
**Success =** he finds macros on the product page and converts to a weekly pack.

### P3 — "The Sharmas", the family buyer (secondary)

Buys larger fresh-cut fruit and vegetable packs, evening slot, heavier at weekends.
Multiple addresses (home plus parents).
**Success =** easy reorder and multi-address management.

### P4 — Ops Manager (internal)

Runs the day: confirms orders, checks slot load, reads prep lists, moves orders through
states, handles cancellations and complaints.
**Success =** one dashboard answers what we make and where it goes.

### P5 — Inventory / Kitchen Manager (internal)

Manages stock, marks items out of stock before cutoff, records wastage.
**Success =** marking a product out of stock immediately stops new orders and flags
affected subscriptions.

### P6 — Super Admin / Owner (internal)

Configures catalogue, pricing, slots, zones, staff accounts and permissions; reads revenue
and retention reports.

## 4. Product scope by surface

### 4.1 Marketing website — `maindomain.com`

Public, SEO-indexed, fast, static-first. Sells the idea; hands off to the app to transact.
Shows live catalogue, combos and subscription plans pulled from the same API.
Full spec: [16-MARKETING-WEBSITE.md](16-MARKETING-WEBSITE.md).

### 4.2 Customer web app — `app.maindomain.com`

Authenticated, mobile-first, PWA-grade experience. Browse, cart, slot, checkout, track.
Subscription management. `noindex`. Full spec: [14-CUSTOMER-UX.md](14-CUSTOMER-UX.md).

### 4.3 Admin panel — `admin.maindomain.com`

Operations console. RBAC-gated, `noindex`, network- and auth-hardened.
Full spec: [15-ADMIN-UX.md](15-ADMIN-UX.md).

### 4.4 API — `api.maindomain.com`

The only writer to the database. Serves all three web surfaces and, later, the native apps
unchanged. Full spec: [06-API-SPECIFICATION.md](06-API-SPECIFICATION.md).

## 5. Functional requirements

Requirements are tagged with their delivery phase: **[MVP]**, **[P2]**, **[P3]**, **[FUT]**.
The authoritative scope table is [33-MVP-SCOPE.md](33-MVP-SCOPE.md).

### 5.1 Catalogue and discovery

| ID | Requirement | Phase |
|---|---|---|
| FR-C1 | Browse products by category and subcategory | MVP |
| FR-C2 | Product detail: images, description, unit/weight, price, MRP, discount | MVP |
| FR-C3 | Product detail: ingredients, nutrition (kcal, protein, carbs, fat, fibre), allergens | MVP |
| FR-C4 | Product detail: preparation notes, storage notes, shelf life | MVP |
| FR-C5 | Product variants (for example 250g / 500g bowl) with independent price and stock | MVP |
| FR-C6 | Keyword search over name, description, category, tags | MVP |
| FR-C7 | Filters: category, price range, dietary tags (vegan, high-protein, no-added-sugar) | MVP |
| FR-C8 | Sort: popularity, price ascending/descending, newest | MVP |
| FR-C9 | Merchandising flags: featured, bestseller, new, popular | MVP |
| FR-C10 | Search suggestions, autocomplete, typo tolerance | P2 |
| FR-C11 | Personalised buy-again and recommendation rails | P3 |

### 5.2 Cart and checkout

| ID | Requirement | Phase |
|---|---|---|
| FR-K1 | Add/remove product or combo, change quantity | MVP |
| FR-K2 | Server-authoritative cart persisted per customer across devices | MVP |
| FR-K3 | Guest cart in local storage, merged into the server cart on login | MVP |
| FR-K4 | Live cart pricing: subtotal, discount, delivery fee, total | MVP |
| FR-K5 | Cart validation on checkout: availability, stock, zone, slot, minimum order | MVP |
| FR-K6 | Select delivery address from saved addresses or add a new one | MVP |
| FR-K7 | Select a delivery date and slot from available, non-full, pre-cutoff slots | MVP |
| FR-K8 | Place order with **Cash on Delivery** payment method | MVP |
| FR-K9 | Idempotent order placement (no duplicate orders on retry or double-tap) | MVP |
| FR-K10 | Apply coupon code | P2 |
| FR-K11 | Online payment at checkout | P4 |

### 5.3 Orders

| ID | Requirement | Phase |
|---|---|---|
| FR-O1 | Order confirmation screen with order number, slot, address, items | MVP |
| FR-O2 | Order list and order detail with full status history | MVP |
| FR-O3 | Track current status against the lifecycle | MVP |
| FR-O4 | Customer-initiated cancellation, allowed only before cutoff/PREPARING (BR-O5) | MVP |
| FR-O5 | Reorder — clone a past order into the cart | MVP |
| FR-O6 | Admin order management: search, filter, status transitions, notes | MVP |
| FR-O7 | Partial delivery and partial refund handling | P2 |
| FR-O8 | Live map tracking of rider | FUT |

### 5.4 Subscriptions

| ID | Requirement | Phase |
|---|---|---|
| FR-S1 | Admin creates subscription **plans** (product or combo, frequency, pricing rules) | MVP |
| FR-S2 | Customer subscribes: start date, slot, address, quantity, delivery days | MVP |
| FR-S3 | Scheduler generates future `subscription_deliveries` and materialises orders | MVP |
| FR-S4 | Pause (with resume date) and resume | MVP |
| FR-S5 | Skip a single upcoming delivery | MVP |
| FR-S6 | Cancel subscription | MVP |
| FR-S7 | View upcoming deliveries and delivery history | MVP |
| FR-S8 | Change quantity (effective from the next un-materialised delivery) | MVP |
| FR-S9 | Change delivery slot or address | MVP |
| FR-S10 | Subscription pricing discount versus the one-time price | MVP |
| FR-S11 | Prepaid subscription cycles with auto-renewal billing | P4 |
| FR-S12 | Customer-editable delivery-day pattern mid-subscription | P2 |

### 5.5 Combos

| ID | Requirement | Phase |
|---|---|---|
| FR-B1 | Admin creates a combo of N products with per-item quantity | MVP |
| FR-B2 | Combo pricing: explicit price or computed discount off the component sum | MVP |
| FR-B3 | Combo availability derived from component availability | MVP |
| FR-B4 | Combo purchasable one-time and subscribable | MVP |
| FR-B5 | Customer-configurable combos (pick any 3) | P3 |

### 5.6 Delivery slots and zones

| ID | Requirement | Phase |
|---|---|---|
| FR-D1 | Admin CRUD delivery slots: name, start, end, cutoff, days, capacity, fee, min order | MVP |
| FR-D2 | Enable/disable a slot; disable a slot for a single date (blackout) | MVP |
| FR-D3 | Per-date capacity tracking and slot-full enforcement | MVP |
| FR-D4 | Serviceability check by pincode before checkout | MVP |
| FR-D5 | Delivery zones with own fee, minimum order value and slot assignment | MVP (single zone seeded) |
| FR-D6 | Holiday and business-closed calendar | MVP |
| FR-D7 | Reserved capacity share for subscriptions versus one-time orders | P2 |
| FR-D8 | Geo-polygon zones instead of pincode lists | P3 |

### 5.7 Inventory

| ID | Requirement | Phase |
|---|---|---|
| FR-I1 | Per-variant stock on hand, reserved, available | MVP |
| FR-I2 | Manual stock adjustment with reason and actor, fully audited | MVP |
| FR-I3 | Automatic reservation on order placement, release on cancel, consumption on dispatch | MVP |
| FR-I4 | Low-stock threshold and out-of-stock flags surfaced in admin | MVP |
| FR-I5 | Inventory movement ledger | MVP |
| FR-I6 | Batches, preparation date, best-before, wastage recording | P2 |
| FR-I7 | Purchase orders and supplier management | FUT |

### 5.8 Accounts

| ID | Requirement | Phase |
|---|---|---|
| FR-A1 | Customer sign-up and sign-in via Firebase phone OTP | MVP |
| FR-A2 | Profile: name, email, phone, date of birth (optional) | MVP |
| FR-A3 | Address book: CRUD, default address, pincode-validated | MVP |
| FR-A4 | Favourites / saved products | MVP |
| FR-A5 | In-app notification centre | MVP |
| FR-A6 | Email sign-in as an additional method | P2 |
| FR-A7 | Account deletion and data export request | P2 |
| FR-A8 | Product reviews and ratings | P2 |

### 5.9 Admin

| ID | Requirement | Phase |
|---|---|---|
| FR-M1 | Admin sign-in, RBAC, protected routes and API authorization | MVP |
| FR-M2 | Operations dashboard (today's orders, revenue, slot load, low stock) | MVP |
| FR-M3 | Catalogue management (categories, products, variants, images, combos) | MVP |
| FR-M4 | Order management and state transitions | MVP |
| FR-M5 | Subscription management and intervention | MVP |
| FR-M6 | Customer list and detail (orders, subscriptions, addresses) | MVP |
| FR-M7 | Slot and zone configuration | MVP |
| FR-M8 | Inventory management | MVP |
| FR-M9 | Admin user and role management | MVP |
| FR-M10 | Audit log viewer | MVP |
| FR-M11 | Prep list and dispatch manifest per slot per day | MVP |
| FR-M12 | Coupons and promotions | P2 |
| FR-M13 | Content management (banners, FAQ, blog) | P2 |
| FR-M14 | Reports and analytics beyond the dashboard | P2 |
| FR-M15 | WhatsApp campaign console | FUT |

### 5.10 Notifications

| ID | Requirement | Phase |
|---|---|---|
| FR-N1 | Domain events published for order and subscription lifecycle changes | MVP |
| FR-N2 | In-app notification feed | MVP |
| FR-N3 | Transactional email via Brevo (order placed, confirmed, out for delivery, delivered, cancelled; subscription created, reminder, paused, cancelled) | MVP |
| FR-N4 | WhatsApp channel | P3 |
| FR-N5 | Web push and mobile push | P3 |
| FR-N6 | SMS fallback | FUT |
| FR-N7 | Customer notification preferences per channel | P2 |

## 6. Non-functional requirements

| ID | Requirement | Target |
|---|---|---|
| NFR-1 | Mobile web performance | LCP ≤ 2.0s p75 on 4G mid-tier Android; INP ≤ 200ms |
| NFR-2 | API latency | p95 ≤ 300ms reads, ≤ 600ms writes (excluding third-party calls) |
| NFR-3 | Availability | 99.5% monthly for API and customer app |
| NFR-4 | Correctness | Zero duplicate subscription deliveries; zero slot over-booking beyond configured capacity |
| NFR-5 | Security | See [23-SECURITY-ARCHITECTURE.md](23-SECURITY-ARCHITECTURE.md); no PII in logs |
| NFR-6 | Accessibility | WCAG 2.2 AA for customer and marketing surfaces |
| NFR-7 | Data durability | RPO ≤ 24h at MVP (daily backup plus PITR), RTO ≤ 4h |
| NFR-8 | Auditability | Every admin mutation recorded in `audit_logs` |
| NFR-9 | API stability | Versioned `/v1`; no breaking change without a new version |
| NFR-10 | Localisation-readiness | All money in INR paise; copy centralised; timezone `Asia/Kolkata` |

## 7. Key product decisions

| Decision | Choice | Rationale |
|---|---|---|
| Purchase model | One-time **and** subscription, subscription as hero | Retention and predictable prep volume |
| Payment at MVP | Cash on Delivery only, behind a payment abstraction | Gateway onboarding is slow and must not block launch (ADR-014) |
| Auth at MVP | Phone OTP only for customers | Indian market norm, lowest friction, phone is the delivery contact anyway (ADR-009) |
| Fulfilment | Slot-based, cutoff-driven batch prep | Matches a fresh-prep kitchen and enables capacity planning |
| Catalogue size | Curated and small | Quality and freshness over breadth |
| Serviceability | Pincode allow-list | Simple and correct enough for one city (ADR-013) |
| Real-time | Polling at MVP, SSE later | Simplest approach that satisfies the requirement (ADR-016) |

## 8. Success metrics

**North star:** weekly delivered subscription deliveries.

| Metric | MVP target |
|---|---|
| Order completion rate (checkout started to placed) | ≥ 70% |
| Slot adherence (delivered within slot window) | ≥ 95% |
| Subscription attach rate (customers with ≥ 1 active subscription) | ≥ 20% by month 3 |
| Subscription 30-day retention | ≥ 60% |
| Skip plus pause rate per active subscription per month | ≤ 25% (health signal, not a failure) |
| Cancellation rate (orders cancelled / placed) | ≤ 5% |
| Out-of-stock substitutions at prep time | ≤ 2% of order lines |

## 9. Assumptions

1. One business, one city, one kitchen/dark-store at launch; the schema supports more.
2. Delivery is executed by in-house staff; there is no third-party logistics API at MVP.
3. Cash is collected by the delivery person and reconciled manually in admin.
4. The kitchen can produce against a cutoff; cutoffs are non-negotiable business rules.
5. Product photography will be supplied; the platform only stores and serves it.
6. Legal and policy page *content* is supplied by the business; we specify the pages only.

## 10. Open questions requiring the business owner

These are carried forward to the final summary and to
[36-DECISIONS-LOG.md](36-DECISIONS-LOG.md) as `PENDING`.

| # | Question | Blocks |
|---|---|---|
| Q1 | Final brand name and domain | Design system, SEO, DNS, Firebase project names |
| Q2 | Launch city and exact serviceable pincodes | Zone seed data, slot capacity sizing |
| Q3 | Kitchen cutoff times for morning and evening prep | Slot seed data (not schema) |
| Q4 | Is COD collected per delivery or per subscription cycle? | Subscription billing model (Phase 4) |
| Q5 | GST treatment — inclusive or exclusive pricing, HSN codes | Pricing display and invoice format |
| Q6 | Minimum order value and delivery fee policy | Zone seed data (not schema) |
| Q7 | Refund mechanism while COD-only (cash return versus credit note) | Refund flow in Phase 2 |
