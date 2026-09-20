# 34 — Phased Development Roadmap

## 0. How to read this

Two numbering systems are in use and must not be confused:

- **PHASE 00–14** — *development* phases. Sequential build order to reach MVP launch.
- **Release P2–P6** — *product* phases after launch, as classified in
  [33-MVP-SCOPE.md](33-MVP-SCOPE.md). These map to PHASE 15–20 below.

Estimates are in **developer-weeks for one full-stack developer**, given as a range. They are
sizing signals, not commitments.

## 1. Sequence and rationale

```
00 Documentation ✅
01 Repository & Infrastructure
02 Database & API Foundation
03 Authentication & RBAC
04 Admin Shell
05 Catalogue (+ Combos)
06 Delivery Zones & Slots        ← before cart, because checkout depends on it
07 Cart, Checkout & Orders
08 Inventory
09 Subscription Engine           ← the riskiest work, before polish
10 Customer App Completion
11 Notifications
12 Marketing Website
13 SEO, Performance & Hardening
14 Launch
```

**Why this order.** Slots come before checkout because checkout cannot be built twice.
Subscriptions come before customer-app polish because they are the largest source of
estimation error and must not be discovered late. Notifications come after orders and
subscriptions because the events they carry must exist first. Marketing comes late because
it consumes a catalogue API that must already be stable.

---

## PHASE 00 — Documentation & Architecture ✅

**Goal** Every architectural decision resolved and written down before code exists.
**Scope** This `/docs` directory (38 documents).
**Dependencies** None.
**Acceptance** Documentation audit (doc 38) passes; open questions listed; owner approves.
**Done** ✅ Awaiting approval.

---

## PHASE 01 — Repository & Infrastructure
**Estimate** 1–1.5 weeks · **Depends on** 00

**Goal** A monorepo that builds, lints, type-checks and deploys an empty but real system to
staging.

**Scope**
- pnpm workspace + Turborepo; `apps/` and `packages/` skeleton per doc 03 §2
- Shared TypeScript, ESLint (with import-boundary rules), Prettier, Vitest configs
- Three Next.js apps and one Hono API scaffolded with a health endpoint
- Docker Compose: Postgres, MinIO, Firebase Auth emulator
- GitHub repository, branch protection, PR template, CODEOWNERS
- CI pipeline (doc 26 §6)
- Vercel projects ×3, Railway project with API + worker + Postgres (staging only)
- Cloudflare account, domain, DNS records
- Firebase projects ×2 (dev/staging)
- Sentry projects, Brevo account
- `.env.example` files and the Zod env schema

**Database** Minimal serviceability slice only — `businesses`, `settings`, `job_runs`, `cities`, `service_pincodes` (ADR-025). Every other table remains PHASE 02.
**API** `GET /v1/health`, `GET /v1/health/ready`.
**Frontend** Three apps rendering a placeholder.
**Tests** CI runs green; one smoke test per app.

**Acceptance**
- `pnpm install && pnpm dev` starts everything locally in one command
- Pushing to `main` deploys all five services to staging automatically
- `api.staging…/v1/health` returns 200; the API reaches Postgres over the private network
- A PR produces three Vercel previews and a green CI run

**Definition of done** A new developer can clone, run `pnpm install`, `docker compose up`,
`pnpm dev`, and have the whole system running in under 15 minutes.

---

## PHASE 02 — Database & API Foundation
**Estimate** 1.5–2 weeks · **Depends on** 01

**Goal** The full schema exists, and the API has every cross-cutting concern in place so no
feature has to invent one.

**Scope**
- Complete Prisma schema per doc 04, including hand-written SQL for partial unique indexes,
  `CHECK` constraints and generated columns
- Migrations, seed scripts (`dev`, `test`, `production-minimal`)
- `packages/contracts` — Zod schemas, DTO types, the error-code catalogue
- `packages/core` skeleton with `money`, `time` and error types
- API middleware: request id, structured logging, CORS, error mapping, rate limiting,
  idempotency, validation
- `@hono/zod-openapi` wired; `/v1/openapi.json` served
- The route registry with its boot-time audience/permission assertion
- Testcontainers integration-test harness

**Database** Every table, enum, index and constraint.
**API** Health, OpenAPI, error handling, no business endpoints yet.
**Tests** Migration applies to a fresh DB; every constraint has a test proving it rejects the
bad case; `money` and `time` unit tests.

**Acceptance**
- `prisma migrate deploy` succeeds on an empty database
- Seed produces a working dataset
- Over-booking, negative stock, duplicate delivery and mismatched order total are all
  rejected **by the database** in tests
- OpenAPI document generates and validates
- A route missing an audience declaration fails at boot

**Done** The schema is trusted enough that features can be built on it without renegotiation.

---

## PHASE 03 — Authentication & RBAC
**Estimate** 1.5–2 weeks · **Depends on** 02

**Goal** Identity and permissions work end to end for both audiences.

**Scope**
- `packages/auth`: dual Firebase verifiers, `Actor` model, permission resolution + cache
- `POST /v1/auth/session`, `GET /v1/auth/me`, `POST /v1/admin/auth/session`, logout
- Permission seeding; role seeding (7 roles); super-admin bootstrap script
- Admin user invitation flow (Firebase user + reset email)
- Customer OTP sign-in in `apps/customer`
- Admin sign-in in `apps/admin` with the `__Host-` session cookie
- `audit_logs` writer helper

**Database** Seed `permissions`, `roles`, `role_permissions`.
**API** Auth endpoints; admin-user and role CRUD.
**Frontend** Customer OTP flow; admin login and session handling.
**Tests** Critical scenarios 1–9 (doc 24 §3), including the **role × endpoint matrix**
generated from the route registry.

**Acceptance**
- A customer signs in with OTP and receives a `users` + `customer_profiles` row
- A customer token is rejected by every admin route
- A suspended account is rejected on the next request
- Each role reaches exactly its permitted endpoints
- Deactivating an admin ends their session

**Done** No further feature needs to think about authentication; it declares a permission and
receives an `Actor`.

---

## PHASE 04 — Admin Shell
**Estimate** 1 week · **Depends on** 03

**Goal** A real admin application to build modules into.

**Scope** Layout, navigation with permission gating, `DataTable`, `FilterBar`, form
primitives, toasts, confirm dialogs, error boundaries; admin users, roles and audit-log
screens; settings screen.

**Acceptance** An admin signs in, sees only permitted menu items, manages staff and roles,
and reads the audit log. Every action they take appears in it.

**Done** Subsequent admin modules are screens, not infrastructure.

---

## PHASE 05 — Catalogue & Combos
**Estimate** 2–2.5 weeks · **Depends on** 04

**Goal** Products exist, are manageable, and are readable by every surface.

**Scope**
- Categories, products, variants, images, tags, combos — admin CRUD + publish workflow
- R2 presigned upload flow + worker validation (magic bytes, dimensions, EXIF strip, LQIP)
- Public catalogue endpoints with filtering, sorting, cursor pagination
- Search: `tsvector` + `pg_trgm` fallback
- Combo pricing, derived availability, admin warnings
- `packages/ui` commerce components: ProductCard, PriceDisplay, VariantSelector

**API** All `/v1/public/*` catalogue endpoints; all `/v1/admin/` catalogue endpoints.
**Tests** Scenarios 10–17; combo availability derivation; `cost_paise` never serialised.

**Acceptance**
- An admin creates a category, product with two variants and three images, publishes it, and
  it appears in `/v1/public/products` within one cache cycle
- A combo with an out-of-stock component reports unavailable, naming the component
- Search handles a typo via the fuzzy fallback

**Done** The catalogue is the single source of truth for all three surfaces.

---

## PHASE 06 — Delivery Zones & Slots
**Estimate** 1.5 weeks · **Depends on** 05

**Goal** The fulfilment constraint system, complete and correct, before anything depends on it.

**Scope**
- Zones, pincodes, slots, slot-zone assignments, holidays — admin CRUD
- `slot_capacity` model and the `roll-slot-capacity` job with the advisory-lock pattern
- Slot-availability algorithm with all eight rejection reasons
- Serviceability endpoint
- `SlotPicker` and `SlotCard` components
- The worker service itself, with `job_runs` and the dead-man's switch

**API** `/v1/public/serviceability`, `/v1/me/delivery-slots`, admin delivery endpoints.
**Tests** Scenarios 18–24; cutoff computation for `cutoff_days_before` 0 and 1; capacity
rows created for the horizon.

**Acceptance**
- An admin creates a slot; capacity rows appear for the booking horizon
- Availability returns the correct reason for every unavailable case
- An unserviceable pincode returns `is_serviceable: false`, not an error
- The capacity-roll job is idempotent across repeated runs

**Done** Checkout can be built against a slot system that is already proven.

---

## PHASE 07 — Cart, Checkout & Orders
**Estimate** 2.5–3 weeks · **Depends on** 06

**Goal** A customer can place a real order, and an admin can fulfil it.

**Scope**
- Cart: server persistence, guest merge, live re-pricing, the `issues[]` model
- Checkout validation and `POST /v1/me/orders` with the full locked transaction
- Order state machine in `packages/core`
- Payment abstraction + COD adapter; `payments` rows from day one
- Order history, detail, tracking, cancellation, reorder
- Admin: order list, detail, transitions, bulk actions, prep list, dispatch manifest,
  COD collection
- `auto-confirm-orders` job

**Tests** Scenarios 25–38 **plus the full concurrency suite** (doc 24 §5).
**Acceptance**
- End-to-end: browse → cart → checkout → order placed → admin advances to delivered → COD
  collected
- 20 parallel orders against a capacity-5 slot yield exactly 5 orders
- Double-submit produces one order
- `expected_total_paise` mismatch creates nothing
- Every illegal transition is rejected

**Done** The business could, in principle, operate — one-time orders only.

---

## PHASE 08 — Inventory
**Estimate** 1–1.5 weeks · **Depends on** 07

**Goal** Stock is tracked accurately and cannot be oversold.

**Scope** Inventory model and movements ledger; reservation, consumption, release and
wastage wired into the order lifecycle; admin inventory screens with bulk morning entry and
one-tap out-of-stock; low-stock alerts; nightly reconciliation.

**Tests** Scenarios 56–60; concurrent last-unit ordering.
**Acceptance** Placing an order reserves; `PREPARING` consumes; cancelling releases or writes
off correctly; stock never goes negative; the ledger sum always equals on-hand.
**Done** The kitchen can trust the numbers.

---

## PHASE 09 — Subscription Engine
**Estimate** 3–3.5 weeks · **Depends on** 08 · **Highest risk in the plan**

**Goal** Subscriptions generate deliveries and orders reliably, exactly once.

**Scope**
- Plans (admin CRUD) and plan items
- Subscription creation with price locking
- `recurrence.ts` — pure recurrence expansion
- `generate-subscription-deliveries` with the watermark
- `materialise-subscription-orders` with locking and failure handling
- Pause, resume, skip, unskip, cancel, change quantity/slot/address/days
- `subscription_events` log
- Customer subscription screens; admin subscription module with the exceptions tab
- `send-delivery-reminders` job

**Tests** Scenarios 39–55 **plus** the duplicate-prevention concurrency tests. This phase
carries the heaviest test burden in the project, deliberately.
**Acceptance**
- Subscribing generates the first horizon of deliveries immediately
- The generator run three times concurrently produces one delivery per date
- Two materialisers on one delivery produce exactly one order
- Pause leaves already-created orders alone and reports them
- A failed materialisation past cutoff becomes `FAILED`, notifies, and appears in admin
- All 18 subscription edge cases (doc 32 §E) behave as specified

**Done** The retention engine works, and its correctness is proven under concurrency rather
than asserted.

---

## PHASE 10 — Customer App Completion
**Estimate** 2 weeks · **Depends on** 09

**Goal** The customer experience is complete and good, not merely functional.

**Scope** Home with all rails and the next-delivery card; category and listing screens;
product detail; favourites; profile and addresses; notification centre; search UI; empty,
loading and error states everywhere; accessibility pass; PWA manifest; responsive polish.

**Tests** E2E journeys 1–6 and 12; accessibility audit; Lighthouse against budgets.
**Acceptance** First order completes in under 90 seconds on a mobile viewport; subscribe in
under 60 seconds; every list has a designed empty state; WCAG 2.2 AA passes.
**Done** The app is something people would choose to use.

---

## PHASE 11 — Notifications
**Estimate** 1–1.5 weeks · **Depends on** 10

**Goal** Customers are told what is happening, through a channel-agnostic pipeline.

**Scope** `packages/notifications` with the port and registry; in-app and Brevo adapters;
outbox dispatcher with backoff and `DEAD` handling; Brevo templates and the required-variable
assertion; the Brevo webhook; notification logs and admin visibility; `NoopChannel` for
non-production.

**Tests** Scenarios 61–65; the staging-never-sends assertion.
**Acceptance** Placing an order produces an outbox event and an email; Brevo being down
delays but never loses a notification and never affects the order; a duplicate dispatch sends
once.
**Done** Adding WhatsApp later requires no change to order or subscription code.

---

## PHASE 12 — Marketing Website
**Estimate** 2 weeks · **Depends on** 11

**Goal** A public site that converts and is indexable.

**Scope** All routes from doc 16 §3; homepage with the pincode checker; live catalogue,
combo and plan pages via ISR; on-demand revalidation webhook from admin publish; static
content pages; legal pages; contact form to Brevo; cross-domain handoff.

**Tests** E2E journey 11; ISR revalidation on publish; API-down fallback to cached content.
**Acceptance** Publishing a product in admin makes it visible on the marketing site within
five minutes (immediately via the webhook); the pincode checker answers correctly; the site
serves cached content when the API is unavailable.
**Done** Acquisition has a front door.

---

## PHASE 13 — SEO, Performance & Hardening
**Estimate** 1.5–2 weeks · **Depends on** 12

**Goal** Fast, discoverable, secure, observable.

**Scope** Metadata and structured data; sitemap and robots; canonicals; `noindex` on app and
admin at both app and edge; image optimisation pass; bundle reduction to budget; caching
layers; database index review with `EXPLAIN`; security headers and CSP rollout; rate-limit
tuning; Cloudflare WAF and Access; full security checklist; Sentry alerts; dashboards;
dead-man's switches; k6 load tests; backup restore test; rollback rehearsal.

**Tests** Lighthouse budgets; security scans; the authorization matrix; load tests with zero
over-booking.
**Acceptance** All doc 22 budgets met; all doc 23 controls verified; a restore and a rollback
have each been performed successfully at least once.
**Done** The system is ready to be trusted with real money and real food.

---

## PHASE 14 — Launch
**Estimate** 1 week · **Depends on** 13

**Scope** Production Firebase, Brevo domain verification, production database and seed data
(business, zone, pincodes, slots, roles, super admin, real catalogue), DNS cutover, launch
checklist (doc 25 §14), admin training, a printed-manifest dry run, soft launch to a small
group, then public launch.

**Acceptance** A real customer places a real order, receives a real delivery, and the
operations team runs the day from the admin panel without engineering assistance.
**Done** **MVP live.**

---

## Post-launch releases

| Phase | Release | Contents | Estimate |
|---|---|---|---|
| **15** | P2 — Commerce depth | Coupons, reviews, notification preferences, partial fulfilment and refunds, email auth, CMS and blog, locality pages, rollup analytics, inventory batches and wastage costing, demand forecasting, ANALYST role, account deletion | 4–6 weeks |
| **16** | P3 — Scale & reach | Multi-zone operations, geo-polygon zones, push notifications, SSE for admin order board, reserved subscription capacity, per-zone admin scoping, DELIVERY_MANAGER role, configurable combos, recommendations | 4–6 weeks |
| **17** | P4 — Payments | Razorpay adapter, online checkout, `PENDING_PAYMENT` state, webhooks, refunds, prepaid subscription cycles, settlement reconciliation | 3–4 weeks |
| **18** | P5 — WhatsApp | Provider selection, outbound templates, inbound intents, opt-in management, admin message log | 3–4 weeks |
| **19** | P6 — Mobile apps | Framework decision, Android + iOS, push, deep links, store submission | 8–12 weeks |
| **20** | Future | Delivery-partner app, live tracking, loyalty, multi-business, warehouse analytics | — |

## Critical path and parallelism

```
01 → 02 → 03 → 04 → 05 → 06 → 07 → 08 → 09 → 10 → 11 → 12 → 13 → 14
```
Roughly **22–27 developer-weeks** to MVP for one developer.

With two developers, these can run in parallel after Phase 04:
- Catalogue admin (05) alongside the design system and customer shell
- Marketing site (12) alongside notifications (11)
- Reports and analytics alongside subscriptions (09)

Phases 06→07→08→09 are strictly sequential; each builds directly on the previous one's
invariants, and parallelising them would mean building checkout twice.

## Risk register

| Risk | Phase | Mitigation |
|---|---|---|
| Subscription engine complexity | 09 | Scheduled early; heaviest test allocation; invariants in the database, not in code |
| Slot concurrency bugs | 06–07 | `CHECK` constraint as the backstop; explicit concurrency and load tests |
| Catalogue content not ready | 05 | Content collection runs in parallel from Phase 01 |
| Firebase OTP cost or delivery issues | 03 | Monitored from day one; email auth is the P2 fallback |
| Scope creep | All | Doc 33 is the contract; additions require an explicit scope decision |
| Single developer bus factor | All | This documentation set is the mitigation |
