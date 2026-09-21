# PHASE 02 — Implementation Report

**Database + API Foundation** · Baseline: `b526c85` (Phase 01)
**Status:** Complete. Awaiting approval before PHASE 03.
**Every result below was executed, not asserted.**

---

## 1. Executive summary

Phase 02 turns the approved architecture into a real database, domain layer, contract layer
and API foundation. 49 new tables, 100 new tests, a generated OpenAPI document, and a
working admin surface for the city/pincode serviceability model.

Three things are worth reading even if nothing else is:

1. **Two real defects were found by testing, not review.** The Phase 02 migration silently
   dropped a tenant-isolation foreign key (ADR-032), and the idempotency claim used `upsert`
   where it needed `create`, so all six concurrent callers believed they had won the mutex.
   Both are fixed, both have regression tests, and one produced a permanent CI guard.
2. **A design deadlock was caught by driving the real API.** City activation required an
   active pincode; pincode activation required an active city. A brand new city could never
   be activated. Fixed and regression-tested (ADR-033).
3. **Admin authentication does not exist yet, and the code says so.** The Phase 02 bypass
   fails closed, refuses in production, and the environment schema refuses to boot if it is
   configured there (ADR-030).

### Numbers

| | Phase 01 | Phase 02 | Total |
|---|---|---|---|
| Database tables | 5 | +49 | **54** |
| CHECK constraints | 8 | +89 | **97** |
| Migrations | 1 | +2 | **3** |
| Tests | 145 | +100 | **245** |
| Domain coverage (stmts / branches) | 99.1 / 93.5 | — | **99.45 / 95.54** |
| ADRs | 27 | +6 | **33** |
| Business rules | 100+ | +1 | — |

---

## 2. Database changes

Full schema per [04-DATABASE-DESIGN.md](04-DATABASE-DESIGN.md), implemented in one migration
plus one corrective migration.

Conventions upheld without exception: UUIDv7 application-generated keys, `BIGINT` paise for
every money column (suffix `_paise`), `TIMESTAMPTZ` in UTC, bare `DATE`/`TIME` for business
dates and slot windows, native enums, soft delete only where documented, snapshots on orders.

**No floating-point money exists anywhere in the schema.** A `9_007_199_254_740_993n` paise
value round-trips exactly, which is verified by test.

---

## 3. Tables created (49)

| Context | Tables |
|---|---|
| Governance | `audit_logs` |
| Identity | `users`, `customer_profiles`, `admin_users`, `roles`, `permissions`, `role_permissions`, `admin_user_roles`, `addresses` |
| Catalogue | `categories`, `products`, `product_variants`, `product_images`, `tags`, `product_tags`, `combos`, `combo_items`, `product_zone_availability` |
| Fulfilment | `delivery_zones`, `delivery_slots`, `slot_zone_assignments`, `slot_capacity`, `business_holidays` |
| Ordering | `carts`, `cart_items`, `orders`, `order_items`, `order_status_history`, `idempotency_keys` |
| Subscription | `subscription_plans`, `subscription_plan_items`, `subscriptions`, `subscription_items`, `subscription_deliveries`, `subscription_events` |
| Inventory | `inventory`, `inventory_movements` |
| Payment | `payments`, `payment_attempts`, `refunds`, `payment_webhook_events` |
| Engagement | `notification_outbox`, `notifications`, `notification_logs`, `notification_preferences`, `favorites`, `reviews` |
| Promotions | `coupons`, `coupon_redemptions` |

The documented entity distinctions are preserved and **not** collapsed:

- **Product** is informational and has no price; **Variant** is the only purchasable unit;
  **Combo** is a bundle of variants with its own price and no inventory of its own.
- **User** is an identity; **Customer Profile** is a commercial relationship.
- **Cart** is not an order state; an order exists only on commit.
- **Payment state** is a separate field from **order state**.
- **Plan → Subscription → Subscription Item → Subscription Delivery → Order** is a five-level
  model, not a `subscription = true` flag.

---

## 4. Constraints

**97 CHECK constraints, 107 unique indexes, 18 partial indexes, 4 append-only triggers.**

The five cross-cutting invariants from [31-BUSINESS-RULES.md](31-BUSINESS-RULES.md) are each
enforced by the database, not only by code:

| # | Invariant | Mechanism |
|---|---|---|
| 1 | No slot over-booking | `CHECK (booked_count >= 0 AND booked_count <= capacity)` |
| 2 | No negative or oversold stock | `CHECK (quantity_on_hand >= 0)`, `CHECK (reserved <= on_hand OR allow_backorder)` |
| 3 | One delivery per (subscription, date) | `UNIQUE (subscription_id, delivery_date)` |
| 4 | One order per subscription delivery | partial `UNIQUE (subscription_delivery_id) WHERE NOT NULL` |
| 5 | The invoice always adds up | `CHECK (total = subtotal - discount + delivery_fee + tax)` |

Verified by execution, not assumption:

| Attempted write | Result |
|---|---|
| 5-digit pincode | `ERROR: service_pincodes_format` |
| Pincode with leading zero | `ERROR: service_pincodes_format` |
| Duplicate pincode within a business | `ERROR: unique violation` |
| Same pincode in a **different** business | **allowed** (uniqueness is per business) |
| `ACTIVE` city with no `activated_at` | `ERROR: cities_active_requires_activated_at` |
| Blank city name | `ERROR: cities_name_not_blank` |
| Country code `"India"` | `ERROR: cities_country_iso3166` |
| Negative price | `ERROR: price_non_negative` |
| MRP below selling price | `ERROR: mrp_gte_price` |
| Subscription price above one-time price | `ERROR: sub_price_lte_price` |
| Negative stock | `ERROR: on_hand_non_negative` |
| Reserving more than on hand | `ERROR: reserved_within_stock` |
| Same, with `allow_backorder` | **allowed** |
| `UPDATE` / `DELETE` on `audit_logs` | `ERROR: audit_logs is append-only` |

### Tenant isolation is enforced by composite foreign keys

`service_pincodes(city_id, business_id) → cities(id, business_id)` and
`product_variants(product_id, business_id) → products(id, business_id)`.

A plain single-column FK would allow a child to attach across a tenant boundary. Both are
tested by attempting exactly that and asserting the database refuses.

---

## 5. Indexes

Every query in doc 04 §13 has an index. Additions worth naming:

- `products.search_vector` — a **GENERATED ALWAYS STORED** `tsvector`, so it cannot drift
  from the row it describes. Verified: renaming a product changes the vector.
- GIN indexes on `search_vector`, `dietary_tags`, `allergens`, and `pg_trgm` on `name` for
  fuzzy matching.
- Expression index on `(quantity_on_hand - quantity_reserved)` for the low-stock dashboard.
- Partial index on `notification_outbox (next_attempt_at) WHERE status IN (PENDING, FAILED)`
  for `FOR UPDATE SKIP LOCKED` dispatch.
- `business_holidays` uses `UNIQUE ... NULLS NOT DISTINCT` so a business-wide holiday (both
  scope columns NULL) cannot be inserted twice. Default NULL handling would treat every such
  row as distinct.

**`array_to_string()` is only STABLE**, so PostgreSQL rejects it inside a generated column.
An immutable `text[]` wrapper preserves the documented search weighting rather than dropping
dietary tags from the index.

---

## 6. Migrations

| Migration | Purpose |
|---|---|
| `20260920090000_phase01_serviceability_foundation` | Phase 01 (unchanged) |
| `20260920120000_phase02_core_schema` | 49 tables, enums, indexes, constraint layer |
| `20260921090000_restore_pincode_business_fk` | Repairs the FK the previous migration dropped |

Verified:
- **Fresh database** — all three apply cleanly to an empty database (55 tables).
- **Existing Phase 01 database** — applied with all Phase 01 rows intact
  (cities=2, pincodes=6, settings=6 before and after).
- Migrations are forward-only and deterministic; the generated SQL was hand-reviewed and the
  constraint layer hand-written.

---

## 7. Seed data

Unchanged from Phase 01 and still idempotent — running it twice produces identical row
counts. Status is written on **create only**, so re-seeding never re-enables a pincode an
admin deliberately switched off.

Noida and its pincodes remain **representative development data**, explicitly not the final
serviceability list. The real list is admin data entry (PD-02).

---

## 8. Domain / core changes

`packages/core` gains four pure modules — no I/O, no framework, no persistence:

| Module | Purpose |
|---|---|
| `pagination` | Cursor encoding, `buildPage` (limit+1, no COUNT), limit normalisation |
| `business-scope` | Branded `BusinessScope` type; cross-business access returns NOT_FOUND, never FORBIDDEN |
| `order-status` | Order and subscription state machines as **data** (docs/09 §3), with no force-status escape hatch |
| `serviceability-admin-service` | City/pincode management rules |

`BusinessScope` is a branded string, so a repository cannot be called without a scope and
cannot be handed a user id by mistake — the type checker enforces what would otherwise be a
review convention.

The order state machine is defined but **not applied**: the service that executes transitions
and their side effects on capacity, stock and payment is PHASE 07. Defining the table now
means every future consumer shares one definition.

---

## 9. API endpoints

| Method | Path | Audience | Phase |
|---|---|---|---|
| GET | `/v1/health` | public | 01 |
| GET | `/v1/health/ready` | public | 01 |
| GET | `/v1/openapi.json` | public | **02** |
| GET | `/v1/routes` | public | 01 |
| GET | `/v1/public/serviceability` | public | 01 |
| GET | `/v1/public/cities` | public | 01 |
| GET/POST | `/v1/admin/cities` | admin | **02** |
| GET/PATCH | `/v1/admin/cities/{id}` | admin | **02** |
| POST | `/v1/admin/cities/{id}/activate` | admin | **02** |
| POST | `/v1/admin/cities/{id}/deactivate` | admin | **02** |
| GET/POST | `/v1/admin/service-pincodes` | admin | **02** |
| GET/PATCH | `/v1/admin/service-pincodes/{id}` | admin | **02** |
| POST | `/v1/admin/service-pincodes/{id}/activate` | admin | **02** |
| POST | `/v1/admin/service-pincodes/{id}/deactivate` | admin | **02** |

Audience separation (`/public`, `/me`, `/admin`, `/internal`, `/webhooks`) is preserved, and
the route registry still asserts at boot that every admin route declares a permission.

**Status is never settable through create or update.** Activation and deactivation are
separate, reason-requiring operations, because deactivating a city stops revenue from an
entire market (BR-SV5). Sending `{"status": "ACTIVE"}` to `POST /v1/admin/cities` is
silently stripped — verified by test, and visible in the OpenAPI document, which has no
`status` property on that request schema.

---

## 10. Contracts

`packages/contracts` is the single definition. The same Zod schemas serve API validation,
OpenAPI generation and SDK types — there is no second schema to drift.

Added: paginated response wrappers, `idParamSchema`, and the OpenAPI builder.

---

## 11. OpenAPI

OpenAPI **3.1**, served at `/v1/openapi.json`, generated from the Zod schemas.

- 12 documented operations across 8 paths, plus health and public serviceability.
- Three security schemes declared: `customerBearer`, `adminSession`, `internalToken`.
- Audience drives the security requirement, so the document shows which endpoints are open.

Built on `@asteasolutions/zod-to-openapi` rather than `@hono/zod-openapi` (ADR-031): our
route registry already carries the audience and permission metadata that the boot-time
security assertion depends on, and the Hono wrapper models neither.

---

## 12. SDK

`packages/sdk` now imports its response types directly from `@healthy-aahar/contracts`, so a
breaking API change fails the frontend type-check rather than surfacing in production. Adds
`X-Client` for future version gating, an async iterator that walks cursor pages without the
caller ever touching a cursor, and structured `ApiError` with `code`, `request_id` and
field-level `details`.

---

## 13. Idempotency

Foundation for PHASE 07/09, built and proven now.

| Scenario | Behaviour |
|---|---|
| Header missing on a required route | `422 VALIDATION_FAILED` |
| Same key, same body, completed | Replay stored response, handler does **not** re-run |
| Same key, in flight | `409 IDEMPOTENT_REQUEST_IN_PROGRESS` |
| Same key, different body | `422 IDEMPOTENCY_KEY_REUSED` |
| Same key, previous attempt failed | Genuine retry (a 500 must not become permanent) |
| Same key, different user | Independent — keys are scoped per user |
| 6 concurrent identical requests | Handler executes **exactly once** |

**A concurrency test caught a real bug here.** The claim used `upsert`, which UPDATES on
conflict, so every concurrent caller believed it had won the mutex and all six ran the
handler. `create` makes the unique index an actual mutex. This is precisely the class of bug
that is invisible in manual testing.

---

## 14. Transactions

Phase 02 operations are single-statement or read-only, so no multi-statement transaction is
yet required. What is established for the phases that need it:

- The lock ordering rule (`slot_capacity` → `inventory` ascending by `variant_id` → `orders`)
  is documented and will be applied in PHASE 07.
- The idempotency mutex uses the unique index rather than an application lock, so it holds
  across processes.
- `truncateAll` in the test harness uses one `TRUNCATE ... CASCADE`, so foreign keys never
  dictate ordering.

Deliberately **not** implemented: order placement, capacity booking and inventory
reservation transactions. Those belong to PHASE 07 and building them now would be scope creep.

---

## 15. Tests

**245 total, all passing.**

| Package | Files | Tests | Kind |
|---|---|---|---|
| `core` | 7 | 144 | Unit (pure domain) |
| `api` | 4 | 58 | Unit + integration (real DB) |
| `contracts` | 1 | 24 | Schema and error catalogue |
| `db` | 1 | 19 | Integration (real DB constraints) |

Integration tests run against a real PostgreSQL, because the invariants they verify are
CHECK constraints, partial unique indexes and triggers — a mock proves nothing about any of
them (ADR-028).

API integration tests drive the app with **no cookies and no `Origin` header**, which is
exactly how a native mobile client will call it — keeping the mobile-readiness claim
falsifiable now rather than in PHASE 19.

---

## 16. Concurrency tests

| Test | Assertion | Result |
|---|---|---|
| 5 concurrent identical pincode creations | Exactly 1 succeeds; 1 row exists | ✅ |
| 5 concurrent city activations | All succeed idempotently; one final state | ✅ |
| 6 concurrent identical idempotent requests | Handler runs exactly once | ✅ |

---

## 17. Security verification

| Control | Result |
|---|---|
| Admin route without token | `401` |
| Admin route with wrong token | `401` (constant-time comparison) |
| Admin route with **no token configured** | `401` — fails **closed**, never open |
| Admin route with `APP_ENV=production` | `403`, and the env schema refuses to boot |
| Error envelope leaks SQL / stack / connection string | **No** — asserted by test |
| Input validation | Zod on every request; unknown keys stripped, not passed through |
| SQL injection | Prisma parameterises; no string-concatenated SQL |
| Request IDs | Present on every response; upstream value validated before trust |
| Secrets in repo | Gitleaks + `check-public-env.mjs` pass |

**Acceptance criterion 24 — no authentication bypass can reach production — is satisfied by
three independent mechanisms** (ADR-030): the env schema refuses to boot, the middleware
refuses at request time, and an absent token rejects rather than allows.

---

## 18. Business isolation verification

| Test | Result |
|---|---|
| Listing cities excludes another business's city | ✅ |
| Fetching another business's city by id | `404`, not `403` (no enumeration oracle) |
| Creating a pincode against another business's city | `404`, nothing written |
| Updating another business's city | `404`, row unchanged |
| Same pincode in two businesses resolves independently | ✅ |
| Database refuses a cross-business pincode attachment | ✅ (composite FK) |
| Database refuses a cross-business variant attachment | ✅ (composite FK) |

Every repository method takes a `BusinessScope` as a required argument and filters inside the
`WHERE` clause — never a post-fetch check.

---

## 19. Phase 01 regression results

**All Phase 01 tests still pass.**

| Suite | Phase 01 | Phase 02 | Now |
|---|---|---|---|
| `contracts` | 24 | +0 | 24 ✅ |
| `core` | 95 | +49 | 144 ✅ |
| `api` | 26 | +32 | 58 ✅ |
| `db` | 0 | +19 | 19 ✅ |
| **Total** | **145** | **+100** | **245 ✅** |

Phase 01 behaviour re-verified end to end: health, readiness, public serviceability across
all five outcomes, the security headers, CORS rejection, and the "a client cannot assert
serviceability" property.

Phase 01 **data** also survived the Phase 02 migration intact.

---

## 20. Coverage

`packages/core/src/domain` — gate is 90%:

```
All files          |   99.45 |    95.54 |    98.11 |   99.45
 business-scope.ts |  100    |  100     |  100     |  100
 errors.ts         |  100    |  100     |  100     |  100
 ids.ts            |  100    |  100     |  100     |  100
 money.ts          |   97.46 |   93.93  |   91.66  |   97.46
 order-status.ts   |  100    |  100     |  100     |  100
 pagination.ts     |  100    |  100     |  100     |  100
 serviceability.ts |   98.96 |   97.05  |  100     |   98.96
 time.ts           |  100    |   85.18  |  100     |  100
```

Above the Phase 01 figure (99.1 / 93.5) despite adding four modules.

---

## 21. Documentation changes

| Doc | Change |
|---|---|
| 03 | OpenAPI generator corrected to `@asteasolutions/zod-to-openapi` |
| 04 | `addresses.city_id` added; `delivery_zones.city_id` replaces free-text city/state; `business_id` scope rule clarified |
| 24 | Integration-test approach corrected to a provisioned database |
| 31 | `BR-SV13` added; invariant-guard note added to cross-cutting invariants |
| 36 | ADR-028 … ADR-033 |

---

## 22. ADR changes

| ADR | Decision |
|---|---|
| **028** | Provisioned test database, not Testcontainers |
| **029** | `addresses` keeps free-text city + nullable `city_id`; `delivery_zones` takes a NOT NULL city FK |
| **030** | Phase 02 admin authorization is a development-only bypass that fails closed |
| **031** | OpenAPI via `@asteasolutions/zod-to-openapi` driven by our route registry |
| **032** | Anything Prisma can model MUST be modelled — written in response to a real regression |
| **033** | City and pincode activation must not deadlock — written in response to a real design flaw |

---

## 23. Deviations from Phase 00 / 01

| # | Deviation | Why | ADR |
|---|---|---|---|
| 1 | `addresses` keeps free-text `city` | BR-D1 requires an unserviceable address to remain saveable | 029 |
| 2 | `delivery_zones` replaces city/state text with a city FK | A zone is operational config and must name a known city | 029 |
| 3 | `product_variants` carries `business_id` | Makes the documented per-business SKU uniqueness an enforceable index | 029 |
| 4 | `business_id` on aggregate roots, not every table | Child tables are reached through a scoped parent; duplicating adds unused FKs | doc 04 |
| 5 | Provisioned test DB instead of Testcontainers | CI already provisions PostgreSQL | 028 |
| 6 | `@asteasolutions/zod-to-openapi` instead of `@hono/zod-openapi` | Preserves the boot-time audience/permission assertion | 031 |
| 7 | CI uses an invariant check instead of `migrate diff --exit-code` | Prisma reports un-modellable objects as permanent false-positive drift | 032 |

---

## 24. Known limitations

| # | Limitation | Plan |
|---|---|---|
| 1 | **Admin authentication does not exist.** The dev bypass is not authentication | PHASE 03 |
| 2 | No RBAC enforcement. Routes declare permissions; nothing checks them yet | PHASE 03 |
| 3 | Rate limiter is in-process; correct for one instance only | Redis at scale-out (PD-14) |
| 4 | No catalogue, cart, order, subscription or inventory **services** — schema only | PHASES 05–09 |
| 5 | No multi-statement transactions yet; none needed in Phase 02 scope | PHASE 07 |
| 6 | `tests/e2e/` still empty — no customer journey exists to test | PHASE 07 |
| 7 | Turborepo can race `prisma generate` against dependent tests on Windows; `--concurrency=1` is reliable | Low priority; CI is Linux |
| 8 | Nothing is deployed. No Vercel, Railway, Cloudflare or GitHub remote exists | Needs your authorisation |
| 9 | Seed pincodes remain representative development data | PD-02 |

---

## 25. Acceptance criteria

| # | Criterion | Result |
|---|---|---|
| 1 | Schema matches approved architecture | ✅ 49 tables per doc 04 |
| 2 | All required Phase 02 tables exist | ✅ 54 total |
| 3 | Migrations apply to a fresh database | ✅ verified |
| 4 | Migrations apply to the Phase 01 database | ✅ verified, data intact |
| 5 | Seeds are idempotent | ✅ run twice, identical counts |
| 6 | Constraints enforce documented invariants | ✅ 97 CHECKs, verified by attempted violation |
| 7 | Business isolation is tested | ✅ 7 tests + 2 composite FKs |
| 8 | City serviceability works from database state | ✅ |
| 9 | Pincode serviceability works from database state | ✅ |
| 10 | No city/pincode hard-coding | ✅ audit clean |
| 11 | API uses `/v1` | ✅ |
| 12 | Audience separation preserved | ✅ asserted at boot |
| 13 | Zod contracts implemented | ✅ |
| 14 | OpenAPI matches real behaviour | ✅ generated from the same schemas |
| 15 | Typed SDK builds | ✅ |
| 16 | API errors are consistent | ✅ code + message + request_id |
| 17 | Cursor pagination works | ✅ 12 rows across 3 pages, no gaps or duplicates |
| 18 | Idempotency foundation tested | ✅ 8 tests incl. concurrency |
| 19 | Transactions used where required | ✅ none required in scope; mechanism established |
| 20 | API integration tests pass | ✅ 58 |
| 21 | Database constraint tests pass | ✅ 19 |
| 22 | Concurrency tests pass | ✅ 3 |
| 23 | Business-scoping tests pass | ✅ |
| 24 | No auth bypass can reach production | ✅ three independent mechanisms |
| 25 | Phase 01 tests remain passing | ✅ 145/145 |
| 26 | lint passes | ✅ 17/17 |
| 27 | typecheck passes | ✅ 17/17 |
| 28 | tests pass | ✅ 245 |
| 29 | build passes | ✅ 6/6 |
| 30 | Coverage above threshold | ✅ 99.45 / 95.54 vs 90 |
| 31 | Documentation updated | ✅ docs 03, 04, 24, 31, 36 |
| 32 | DECISIONS-LOG updated | ✅ ADR-028…033 |
| 33 | Phase 02 report created | ✅ this document |

**33 of 33 met.**

---

## 26. Next phase

**PHASE 03 — Authentication & RBAC.** Not started; awaiting approval.

Scope per [34-PHASED-ROADMAP.md](34-PHASED-ROADMAP.md): dual Firebase verifiers, the `Actor`
model, permission resolution with cache invalidation, `POST /v1/auth/session`, the admin
session cookie, role and permission seeding, the admin invitation flow, and the generated
role × endpoint authorization matrix test.

**PHASE 03 deletes `apps/api/src/middleware/dev-admin-auth.ts` and the `ADMIN_DEV_TOKEN`
variable.** The permission strings every admin route already declares become enforced rather
than merely documented.

**Stopping here as instructed.**
