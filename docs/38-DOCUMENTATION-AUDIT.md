# 38 — Documentation Consistency Audit

Performed after all documents were written, against the 16 required checks. Every
inconsistency found is listed, including those already fixed — a clean audit with nothing
found would mean the audit was not performed.

**Date:** 2026-09-20 · **Scope:** docs 01–37 · **Result:** PASS with 6 defects found and
fixed, 3 accepted deviations, 8 open items (all requiring the business owner).

---

## Part A — the 16 required checks

### 1. Database entities match API entities ✅
Every entity exposed by an endpoint in doc 06 resolves to a table in doc 04. Spot-checked:
`Product`→`products`+`product_variants`+`product_images`; `Cart`→`carts`+`cart_items`;
`Order`→`orders`+`order_items`+`order_status_history`+`payments`;
`Subscription`→`subscriptions`+`subscription_items`+`subscription_deliveries`;
`Slot`→`delivery_slots`+`slot_capacity`.

**Defect D1 (fixed):** `subscription_plan_items` was specified in doc 04 §8.1 and appeared in
the ERD, but was missing from the schema map in doc 04 §2. Added.

**Defect D2 (fixed):** `job_runs` was introduced in doc 28 §8 and referenced by docs 29, 34
and 35, but had no table specification in doc 04. Added as §3.4 and to the schema map.

### 2. API entities match frontend requirements ✅
Every screen in docs 14, 15 and 16 has endpoints. Verified: the customer subscription detail
screen needs `rules` (doc 06 §9 provides it); the admin prep list needs per-variant
aggregation including combo components (doc 06 §11.2 `/orders/prep-list`, doc 12 §2 defines
the aggregation); the marketing pincode checker needs `/v1/public/serviceability` (doc 06
§4). The cart `issues[]` codes in doc 06 §6 match the states doc 14 §3.4 renders.

### 3. Subscription logic matches order logic ✅
Doc 11 §4.2 creates orders with `source='SUBSCRIPTION'`, `channel='SYSTEM'` and
`subscription_delivery_id`, which is exactly what doc 04 §7.3 specifies and doc 09 §6
requires. The state machine in doc 09 §3 is shared; doc 11 adds no order states. BR-O14 and
BR-S10 state the same rule from both sides and do not conflict.

### 4. Delivery slots match subscription delivery logic ✅
Doc 11 §4.2 locks `slot_capacity` with the same procedure as doc 10 §6.2 and doc 09 §4.
Lock ordering is identical (`slot_capacity` → `inventory` → `orders`), consistent with doc 04
§14. The separate horizons (booking 7d, generation 14d, materialise 36h) are consistent
across docs 10 §9, 11 §9 and 27 §3.

**Defect D3 (fixed):** doc 10 jumped from the title to "## 2. Model" with no section 1.
A §1 Purpose was added.

### 5. Inventory matches product/order logic ✅
Doc 13's reservation lifecycle matches doc 09's transition side effects exactly:
reserve at `PENDING`, consume at `PREPARING`, release or write off on cancellation depending
on stage (BR-O6 = BR-I5). Combo components drive inventory in both doc 12 §5 and doc 13 §2.
`track_inventory=false` is honoured identically in docs 06, 12 and 13.

### 6. RBAC matches admin modules ✅
Every admin endpoint group in doc 06 §11 has a permission in doc 08 §2, and every permission
in doc 08 §2 is used by at least one endpoint. Every module in doc 15 §2 maps to permissions
held by at least one role in the doc 08 §4 matrix.

**Accepted deviation A1:** doc 08 ships **7** roles, not the 9 suggested in the brief.
`ANALYST` and `DELIVERY_MANAGER` are deferred to P2/P3 with rationale (no analytics function
and no rider fleet at launch) and are trivial to add because roles are data. Recorded in
doc 08 §3 and doc 33 §5.

### 7. Authentication matches frontend/backend architecture ✅
Doc 07's bearer-token pattern for customers and cookie pattern for admin is consistently
described in docs 06 §1.2, 14, 15 §11, 23 §3 and 30 §2. The customer app is stated as
cookie-free in docs 07 §4.3 and 30 §2 — necessary for the mobile claim and consistent
throughout.

### 8. Firebase architecture is consistent ✅
Two projects appear identically in docs 03 §6, 07 §2, 23 §3, 25 §14, 27 §3/§4 and 36
(ADR-010). Environment variables in doc 27 provide separate config blocks for both projects
on both server and client. `users` is keyed `(firebase_uid, user_type)` in doc 04 §4.1,
which is what makes a dual identity representable.

### 9. Brevo architecture is consistent ✅
Brevo appears only behind `NotificationChannel` in docs 03 §7, 18 §6 and 19-adjacent text;
no domain document calls it directly. The sender subdomain `mail.maindomain.com` with
SPF/DKIM/DMARC is consistent between docs 18 §6 and 25 §3/§14. `NOTIFICATIONS_ENABLED` and
`NoopChannel` appear consistently in docs 18 §10, 25 §10 and 27 §3/§5.

### 10. Cloudflare / Vercel / Railway architecture is consistent ✅
The split is identical in docs 02 §2, 03 §11 and 25 §1–§6. DNS records in doc 25 §3 cover
every hostname referenced elsewhere, including `cdn` (doc 03 §8) and `mail` (doc 18 §6).
Rate limits agree between doc 06 §1.9, doc 23 §8 and doc 25 §4. CSP `connect-src` in doc 23
§6 includes the Firebase and API origins the frontends actually use.

### 11. Future payment integration does not require redesign ✅
Doc 19 §10's eight-step checklist touches only: a new adapter, a registry entry, an
`ALTER TYPE ADD VALUE`, a webhook route, a UI step, an expiry job and reconciliation. It
does **not** require changing orders, subscriptions, slots or inventory. The `payments`,
`payment_attempts`, `refunds` and `payment_webhook_events` tables exist at MVP (doc 04 §10)
and carry COD rows, so the abstraction is exercised in production from day one.

### 12. Future WhatsApp integration does not require redesign ✅
Doc 20 §3's prerequisite table maps each requirement to an MVP artefact: verified E.164
phone, outbox, `NotificationChannel`, `notification_logs.channel`,
`notification_preferences`, the webhook pattern, and `packages/core` services callable
without HTTP. Doc 20 §8 explicitly states that its checklist contains no change to order or
subscription code, matching BR-N10.

### 13. Future mobile apps can use the same APIs ✅
Doc 30 §2's table maps each mobile requirement to an MVP property. Critically, doc 30 §10
makes the claim **falsifiable during the build** — a no-browser-context integration suite
and CI Kotlin-client generation from Phase 3 — rather than leaving it as an assertion to be
tested in Phase 19. `X-Client` collection from day one (doc 06 §1.2) is the one item that
cannot be retrofitted onto shipped apps, and it is in the MVP.

### 14. SEO architecture is consistent with the marketing website ✅
Doc 21's indexing policy matches doc 16's rendering strategy: ISR with on-demand
revalidation, structured data generated from the same API response that renders the page
(BR-SEO2 = BR-MK3). Canonical handling is stated consistently in docs 14 §9, 16 and 21 §1.
`noindex` is applied at both app and edge in docs 21 §1 and 25 §14.

### 15. No MVP requirement depends on a future feature ✅
Checked every MVP item in doc 33 §3 against the deferred list in §4:
- Checkout uses COD via the payment abstraction — no gateway needed.
- Notifications use in-app + email — no WhatsApp or push needed.
- Search uses Postgres — no external engine needed.
- Subscriptions use per-delivery COD — no prepaid billing needed.
- One zone is seeded — no multi-zone UI needed.
- Inventory uses the aggregate — no batches needed.
- Order tracking uses polling — no SSE or WebSockets needed.
- Combos are fixed — no configurable combos needed.
- RBAC uses 7 roles — no per-zone scoping needed.
No MVP item depends on anything in P2–P6.

### 16. No undocumented critical business rule ✅
Doc 31 consolidates 100+ rules across 11 categories with enforcement location and source
document. Every `BR-*` referenced in any document resolves to an entry. The five
cross-cutting invariants are each backed by a database constraint and a required
concurrency test (doc 24 §5).

**Defect D4 (fixed):** the job that auto-confirms `PENDING` orders at cutoff was called
`close-pending-orders` in docs 09, 34 and 35, while doc 02 listed only `close-stale-orders`
(a different job, flagging undelivered orders at 23:30). Two distinct jobs had collided into
one ambiguous name. Standardised: `auto-confirm-orders` (every 15 min, BR-O3) and
`close-stale-orders` (23:30 daily). Doc 02's job table now lists both.

---

## Part B — additional cross-checks performed

| Check | Result |
|---|---|
| Every enum value in doc 04 §1.5 is used somewhere | ✅ |
| Every error code in doc 06 §15 is raised by a documented rule or flow | ✅ |
| Every `EC-*` in doc 32 has a defined behaviour and an owning document | ✅ |
| Every `ADR-*` referenced in a document exists in doc 36 | ✅ |
| Every `PD-*` pending decision states what it blocks and by when | ✅ |
| Phase numbering: development PHASE 00–14 vs release P2–P6 | ✅ after D5 |
| Money always expressed as `_paise` integers | ✅ |
| No document hard-codes a slot time as a constant | ✅ |
| Every job named in doc 02 §7 appears in doc 28 §8 monitoring | ✅ after D4 |
| Every table in doc 04 appears in an ERD in doc 05 or is noted as P2 | ✅ after D1/D2 |
| Test scenarios in doc 24 §3 cover every cross-cutting invariant | ✅ |
| Doc 35 checklist covers every phase deliverable in doc 34 | ✅ |

**Defect D5 (fixed):** doc 33's risk table referenced "Phase 7" for the subscription engine
while doc 34 placed it at PHASE 09. Corrected to PHASE 09, and doc 34 §0 now states
explicitly that development phases (00–14) and release phases (P2–P6) are different
numbering systems.

**Defect D6 (fixed):** the section numbering in doc 10 started at 2 (see check 4).

---

## Part C — accepted deviations from the brief

These are deliberate departures, each with a reason. They are listed so they are reviewed
rather than discovered.

| ID | Brief suggested | We chose | Why |
|---|---|---|---|
| A1 | 9 admin roles | 7 roles | `ANALYST` and `DELIVERY_MANAGER` have no holder at launch; roles are data and cost nothing to add later (doc 08 §3) |
| A2 | `main` + `development` + feature branches | Trunk-based, no `develop` | Per-PR previews already provide staging; a long-lived `develop` adds a permanent merge tax for a small team (ADR-018) |
| A3 | `CART` and `CHECKOUT` as order states | Separate `carts` table; order exists only on commit | Cart-as-order-state pollutes the orders table and corrupts every order metric (doc 09 §1) |
| A4 | `REFUNDED` / `PARTIALLY_REFUNDED` as order states | Payment states | An order can be `DELIVERED` and `REFUNDED` simultaneously; one enum cannot express both facts (doc 09 §1, BR-O1) |
| A5 | The suggested table list | Extended and restructured | Added `product_variants` as the sole purchasable unit, `slot_capacity`, `subscription_plan_items`, `notification_outbox`, `idempotency_keys`, `job_runs`, `business_holidays`, `zone_pincodes`, `product_zone_availability`; merged `customers` into `customer_profiles` (doc 04) |

A3, A4 and A5 are the substantive ones and each is argued in its owning document.

---

## Part D — open items

All eight require the business owner; none blocks documentation completeness, and only
PD-01 blocks PHASE 01. Full detail in [36-DECISIONS-LOG.md](36-DECISIONS-LOG.md).

| ID | Question | Blocks | Needed by |
|---|---|---|---|
| PD-01 | Brand name and domain | Naming everywhere | **PHASE 01** |
| PD-02 | Launch city and pincodes | Zone seed data | PHASE 06 |
| PD-03 | Slot windows and cutoffs | Slot seed data | PHASE 06 |
| PD-04 | Delivery fee, free-delivery threshold, minimum order | Zone seed data | PHASE 06 |
| PD-05 | GST treatment | Price display and invoices | PHASE 07 |
| PD-06 | COD basis for subscriptions | Billing model | PHASE 09 |
| PD-07 | Refund mechanism under COD | Refund flow | P2 |
| PD-08 | Plan commitments and pause/skip limits | Plan seed data | PHASE 09 |

PD-02 through PD-08 are **configuration and seed data**, not schema. Any answer fits the
design as written; this is the practical test of whether the "admin-configurable, nothing
hard-coded" requirement was actually met.

---

## Part E — what this audit could not verify

Stated plainly, because an audit that claims more than it checked is worse than none:

1. **That the estimates in doc 34 are accurate.** They are informed ranges, not measurements.
2. **That the performance budgets in doc 22 are achievable** on the real catalogue with real
   photography. They are targets derived from industry norms and must be validated in
   PHASE 13.
3. **That the UX converts.** Docs 14 and 16 describe a considered design, not a tested one.
4. **That the security model has no gap.** Doc 23 reflects a threat model and best practice;
   only a penetration test can validate it (scheduled pre-launch, doc 23 §15).
5. **That the schema survives contact with real operations.** Some column will be wrong. The
   migration discipline in doc 25 §8 exists precisely because of this.
6. **That third-party costs match doc 25 §13.** OTP SMS pricing in particular scales with
   sign-ups and should be monitored from the first week.

## Verdict

**PASS.** The documentation set is internally consistent, implementation-ready, and free of
circular or missing dependencies. Six defects were found and fixed during this audit; five
accepted deviations from the brief are argued in their owning documents; eight open items
await the business owner, of which one blocks PHASE 01.
