# 24 — Testing Strategy

## 1. Philosophy

Test where the risk is. This system has a small number of places where a bug is expensive —
money, slot capacity, subscription duplication, authorization — and a large number of places
where a bug is cosmetic. Coverage is allocated accordingly, not uniformly.

The shape is a **diamond**, not a pyramid: thin on component tests (React components change
constantly and break tests without finding bugs), thick on integration tests against a real
PostgreSQL (where the actual invariants live), thin on E2E (slow, flaky, expensive).

```
        ╱  E2E  ╲          ~15 specs   critical journeys only
      ╱ Integration ╲      ~250 tests  API + real DB — the core of the suite
    ╱   Unit (domain)  ╲   ~400 tests  pure functions: pricing, recurrence, state machines
  ╱  Static analysis    ╲  TypeScript strict, ESLint, Zod, OpenAPI diff
```

## 2. Levels

### 2.1 Static
`tsc --noEmit` in strict mode with `noUncheckedIndexedAccess`; ESLint 9 with import-boundary
rules (doc 02 §4); Prettier; OpenAPI diff against `main`. These catch more real defects per
second than any test and run first in CI.

### 2.2 Unit — `packages/core`
Pure functions with no I/O, run in milliseconds, exhaustively covered.

| Module | Representative cases |
|---|---|
| `money` | Rounding half-up, line totals, discount application, tax apportionment, no float leakage |
| `recurrence` | Daily, weekly, alternate-day anchoring, monthly 31st clamping, DST-free correctness, range boundaries |
| `slot-eligibility` | All eight rejection reasons, cutoff crossing midnight, day-of-week edges |
| `order-state-machine` | Every legal transition, every illegal transition, actor permission per transition |
| `subscription-state-machine` | Same |
| `pricing` | Variant vs subscription price, combo `FIXED` and `DISCOUNT` modes, savings never negative |
| `cart-totals` | Delivery fee waiver, minimum order, empty cart |
| `time` | IST conversions, `cutoff_at` computation, date-boundary behaviour |

**Target: 95% branch coverage in `packages/core/src/domain`.** These functions are cheap to
test and catastrophic to get wrong.

### 2.3 Integration — API against a real database
Vitest against a **provisioned PostgreSQL test database** (ADR-028 — Testcontainers was
specified in PHASE 00 and replaced in PHASE 02; CI already provisions a PostgreSQL service,
so starting a second one bought nothing). **Not** a mocked database: the invariants we
rely on are enforced by unique indexes, `CHECK` constraints and row locks, and a mock proves
nothing about any of them.

Per-test isolation by `TRUNCATE ... CASCADE`; migrations applied once per run so the suite
exercises exactly the SQL that runs in production, including the hand-written CHECK
constraints and triggers Prisma cannot express.

Covered: every endpoint's happy path, validation failures, authentication, authorization,
ownership isolation, and the concurrency scenarios in §5.

### 2.4 E2E — Playwright
Against a preview deployment with a seeded database. Chromium desktop plus mobile Chrome
emulation. Deliberately few, deliberately high-value (§6).

### 2.5 Contract
The OpenAPI document is generated from Zod schemas; CI diffs it against `main` and fails a
breaking change without a version bump. This is what protects shipped mobile apps from a
backend deploy (doc 30 §5).

## 3. Critical scenarios — the required list

Every scenario below must have an automated test before launch. These are the tests that
justify the suite's existence.

### Authentication & authorization
1. Registration via phone OTP provisions `users` + `customer_profiles` exactly once.
2. Repeat sign-in does not create a duplicate user.
3. A customer token is rejected by every `/v1/admin/*` route (wrong Firebase audience).
4. An admin token is rejected by `/v1/me/*` routes.
5. A suspended account is rejected on the next request, even with a still-valid token.
6. Each role can access exactly its permitted endpoints — **a full role × endpoint matrix
   test**, generated from the route registry so a new route without coverage fails CI.
7. Customer A receives `404`, not `403`, for customer B's order, address and subscription.
8. An expired token returns `401 TOKEN_EXPIRED`.
9. Deactivating an admin revokes their session.

### Catalogue & cart
10. Product listing respects category, dietary, price and availability filters.
11. Search returns full-text matches and falls back to fuzzy for a typo.
12. `cost_paise` never appears in any public or customer response (asserted across all
    catalogue endpoints).
13. Adding an existing line increments quantity rather than duplicating it.
14. Quantity is clamped to `max_order_quantity` and reported as a warning.
15. Cart totals recompute after an admin price change.
16. Guest cart merge sums quantities and drops unavailable items.
17. Cart validation reports every blocking issue simultaneously, not just the first.

### Delivery slots
18. A slot past its cutoff is unavailable with `CUTOFF_PASSED`.
19. A full slot is unavailable with `SLOT_FULL`.
20. A slot is unavailable on a weekday outside `available_days`.
21. A holiday removes the slot for that date.
22. A blocked date removes the slot.
23. `cutoff_at` is computed correctly for `cutoff_days_before` of 0 and 1.
24. An unserviceable pincode returns `is_serviceable: false`, not an error.

### Orders
25. Order placement creates order, items, status history, payment and outbox event in one
    transaction.
26. Placement increments `slot_capacity.booked_count` and reserves inventory.
27. **Capacity is never exceeded under concurrency** (§5).
28. `expected_total_paise` mismatch returns `409 PRICE_CHANGED` and creates nothing.
29. Insufficient stock returns `409` with per-item detail and creates nothing.
30. Below-minimum order is rejected.
31. Idempotent replay returns the same order; a different body returns `422`.
32. Customer cancellation before cutoff releases capacity and reservation.
33. Customer cancellation after cutoff is rejected.
34. Admin cancellation after `PREPARING` writes off stock as wastage.
35. Every illegal status transition is rejected with the allowed set returned.
36. Combo orders create one priced parent plus N zero-priced components, and `subtotal`
    counts only parents.
37. Inventory reservation for a combo covers component quantity × combo quantity.
38. `order_number` is unique under concurrent placement.

### Subscriptions
39. Creating a subscription snapshots prices and generates the first horizon of deliveries.
40. The generator is idempotent — running it three times produces one delivery per date.
41. **Two concurrent materialisers produce exactly one order** (§5).
42. Materialisation into a full slot leaves the delivery `SCHEDULED` and retries.
43. Past-cutoff materialisation failure marks the delivery `FAILED` and notifies.
44. Pause cancels future `SCHEDULED` deliveries and leaves `ORDER_CREATED` ones untouched.
45. Pause returns the affected already-created orders.
46. Resume regenerates from tomorrow, never retroactively.
47. Skip before the cutoff succeeds; after materialisation it returns `ALREADY_MATERIALISED`
    with the order number.
48. Skip and pause limits are enforced per calendar month.
49. Quantity change applies from the next un-materialised delivery only.
50. A catalogue price change does not alter an existing subscription's price.
51. Cancelling a subscription order cancels that delivery, not the subscription.
52. `min_duration_days` blocks early cancellation.
53. Deleting an address used by an active subscription is rejected.
54. A holiday suppresses generation for that date.
55. Alternate-day and monthly recurrences handle month boundaries correctly.

### Inventory
56. Placement reserves; `PREPARING` consumes; cancellation releases or writes off correctly.
57. Stock cannot go negative.
58. `track_inventory = false` never blocks a sale.
59. Every inventory change writes a matching movement; the ledger sum equals on-hand.
60. Concurrent orders for the last unit: one succeeds, one gets `409`.

### Notifications
61. Order placement writes exactly one outbox event, in the same transaction.
62. A failed send retries with backoff and becomes `DEAD` after 5 attempts.
63. `dedupe_key` prevents duplicate sends.
64. A notification failure does not roll back the order.
65. Non-production uses `NoopChannel` — no external call is made.

## 4. Test data

`database/seeds/test.ts` provides a deterministic fixture set: one business, one zone with
three pincodes, two slots (morning cutoff 22:00 D-1, evening cutoff 13:00 D-0), five
categories, twenty products with variants, three combos, two subscription plans, five
customers in known states (new, one-time buyer, active subscriber, paused subscriber,
suspended), and one admin per role.

Rules: no real phone numbers or emails; no production data in any non-production environment,
ever; fixtures are created through service functions rather than raw inserts wherever
possible, so fixtures exercise the same invariants as production code.

## 5. Concurrency tests

These are the highest-value tests in the suite, because these bugs are invisible in manual
testing and catastrophic in production.

| Test | Method | Assertion |
|---|---|---|
| Slot over-booking | 20 parallel `POST /v1/me/orders` for a slot with capacity 5 | Exactly 5 succeed, 15 get `409`, `booked_count = 5` |
| Inventory oversell | 10 parallel orders for 1 unit of stock | Exactly 1 succeeds, `quantity_on_hand ≥ 0` |
| Duplicate subscription delivery | Generator run 3× concurrently for one subscription | One delivery per date |
| Duplicate subscription order | Materialiser run 2× concurrently on one delivery | Exactly one order; the second transaction fails |
| Idempotent order | Same key sent 5× in parallel | One order; others replay or get `409 IN_PROGRESS` |
| Concurrent status change | Two admins transition the same order | One succeeds, one gets `409` |
| Deadlock check | Interleaved orders touching overlapping variants in different request orders | No deadlock — validates the fixed lock ordering |

## 6. E2E journeys

1. **First order** — sign up (OTP stub) → browse → add to cart → checkout → order placed →
   visible in order history. Asserts the under-90-second budget.
2. **Repeat order** — sign in → buy again → place.
3. **Subscribe** — product → subscribe → configure → confirm → upcoming deliveries visible.
4. **Pause and resume** — with already-created order handling.
5. **Skip a delivery** — before and after materialisation.
6. **Cancel an order** — within and outside the window.
7. **Admin day** — sign in → confirm orders → prep list → advance statuses → mark delivered
   → collect COD.
8. **Admin catalogue** — create product with variant and image → publish → verify it appears
   on marketing and in the app.
9. **Admin slot** — create slot → verify it is bookable → block a date → verify it is not.
10. **Permission denial** — a `CONTENT_MANAGER` cannot reach orders in the UI or the API.
11. **Marketing conversion** — home → pincode check → product → CTA → lands in the app.
12. **Mobile viewport** — the first-order journey at 375px.

OTP is stubbed via the Firebase Auth emulator in E2E; we test our flow, not Firebase's SMS.

## 7. Performance and load

k6, before launch and before any expected peak:
- 100 concurrent browsers on the catalogue → p95 within budget.
- 20 concurrent checkouts on the same slot → correct capacity, no deadlock.
- Materialisation of 1,000 subscriptions → completes within the hourly window.
- Sustained 50 rps on public catalogue for 10 minutes → no memory growth, stable p95.

Lighthouse CI per PR on marketing and customer apps, gated on the doc 22 budgets.

## 8. Security testing

Automated in CI: `pnpm audit`, CodeQL, Gitleaks, the role × endpoint authorization matrix,
security-header assertions, CORS origin rejection, rate-limit enforcement, and an assertion
that no response body contains a `cost_paise` field.
Manual before launch: OWASP Top 10 review, IDOR probing, token-audience confusion attempts,
webhook signature forgery, upload bypass attempts.

## 9. CI gates

| Stage | Blocking |
|---|---|
| Type check, lint, format | ✅ |
| Unit tests | ✅ |
| Integration tests | ✅ |
| Migration check (applies cleanly to a fresh DB and to a prod-shaped snapshot) | ✅ |
| OpenAPI breaking-change diff | ✅ |
| Build all apps | ✅ |
| Bundle size gate | ✅ |
| Lighthouse CI | ✅ on marketing and customer |
| E2E | ✅ on PRs targeting `main`; nightly on `develop` |
| Security scans | ✅ |
| Coverage: `packages/core` ≥ 90%, overall ≥ 70% | ✅ |

## 10. What we deliberately do not test

| Not tested | Why |
|---|---|
| Firebase's OTP delivery | Third-party; we test our handling of the resulting token |
| Brevo's email delivery | Third-party; we test that we called the adapter with correct arguments |
| Cloudflare and Vercel behaviour | Platform |
| Exact pixel rendering | Visual regression is high-maintenance and low-yield at this stage |
| Every React component in isolation | Covered more meaningfully by E2E journeys |
| Prisma's query generation | Library |
