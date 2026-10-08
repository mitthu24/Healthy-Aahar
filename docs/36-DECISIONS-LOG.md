# 36 — Architecture Decision Log

Every binding decision, with the alternatives considered and why they lost. A decision here
is authoritative; changing one requires a new ADR that supersedes it, not an edit.

**Status:** `ACCEPTED` · `PENDING` (needs input) · `SUPERSEDED` · `REVISIT` (deliberately
revisited at a named trigger).

---

### ADR-001 — Monorepo with pnpm + Turborepo
**Status** ACCEPTED · **Doc** 03 §2

Three frontends, an API and a worker share types, validation schemas, design tokens and
domain logic.

*Options:* polyrepo with published internal packages; polyrepo with duplication; monorepo.
*Chosen:* monorepo.
*Why:* polyrepo forces either a package-publishing workflow (release friction for a small
team, constant version skew) or copy-paste (guaranteed drift). The monorepo's only real cost
— broader CI runs — is solved by Turborepo's affected-graph and remote cache.
*Trade-off accepted:* one repository grows large; discipline is needed on package boundaries,
enforced by `eslint-plugin-boundaries`.

---

### ADR-002 — A separate always-on API service on Railway
**Status** ACCEPTED · **Doc** 02 §3 · **The load-bearing decision**

*Options:* (A) Next.js route handlers inside each app on Vercel; (B) a dedicated Hono service
on Railway at `api.maindomain.com`; (C) a heavier framework on a heavier platform.
*Chosen:* B.
*Why:* the requirement that future mobile apps use the same backend makes a frontend-hosted
API structurally wrong — the mobile client would depend on a web deployment's URL and release
cycle. A dedicated origin also gives a persistent connection pool (no serverless pool
juggling on the checkout path), co-location with Postgres on a private network, and a natural
home for the cron scheduler.
*Trade-off accepted:* one more service to deploy and monitor; CORS must be configured
explicitly.

---

### ADR-003 — Three separate Next.js applications
**Status** ACCEPTED · **Doc** 03 §2

*Options:* one app with route groups; three apps.
*Chosen:* three.
*Why:* opposite requirements — static/indexed versus dynamic/`noindex`, a 100KB bundle
budget versus a 350KB one, content-driven versus product-driven deploy cadence. One app would
force the strictest constraint on everything and couple unrelated release risk.
*Trade-off accepted:* shared code must live in packages, which the monorepo already provides.

---

### ADR-004 — A separate worker service for scheduled jobs
**Status** ACCEPTED · **Doc** 02 §7

*Options:* in-process cron inside the API; Vercel Cron hitting HTTP endpoints; a separate
Railway worker; a queue system (BullMQ + Redis).
*Chosen:* separate Railway worker with `node-cron` and Postgres advisory locks.
*Why:* keeps a long nightly batch off the checkout latency path and allows independent
restart and scaling. Vercel Cron's execution ceiling is a poor fit for batch generation. A
queue broker is infrastructure we do not yet need — and the job interfaces are written so
BullMQ can be introduced without touching job logic.
*Revisit when:* job volume or retry semantics outgrow advisory locks.

---

### ADR-005 — `business_id` on every operational table from day one
**Status** ACCEPTED · **Doc** 02 §9

*Chosen:* carry the column now; defer tenant isolation policy (RLS, schema separation).
*Why:* adding a scoping column to 30 populated tables later is a large, risky migration;
adding it now is free. The expensive part of multi-tenancy is the isolation policy, which is
correctly deferred until a second business is real.
*Trade-off accepted:* a column that is constant at MVP, which reviewers must not "clean up".

---

### ADR-006 — Money as `BIGINT` paise
**Status** ACCEPTED · **Doc** 04 §1.2

*Options:* `FLOAT`; `NUMERIC(12,2)`; `BIGINT` minor units.
*Chosen:* `BIGINT` paise.
*Why:* floats cannot represent decimal currency exactly. `NUMERIC` is exact but arrives in
JavaScript as a string or a lossy number and invites `parseFloat`. Integer minor units are
exact, safe below 2^53, and match what every payment gateway expects — no conversion layer.
*Convention:* every money column ends in `_paise`; formatting happens once, in `money.ts`.

---

### ADR-007 — UTC storage, `Asia/Kolkata` business logic, bare `DATE` for service dates
**Status** ACCEPTED · **Doc** 04 §1.3

*Why:* instants belong in UTC; a business day does not. `service_date` as a bare `DATE`
means "the morning of 14 March" is unambiguous regardless of server locale or DST. A real
timezone library is used rather than a fixed `+05:30` offset so a future city in a DST zone
does not require rewriting date logic.

---

### ADR-008 — Prisma as the ORM
**Status** ACCEPTED · **Doc** 03 §4 · **REVISIT** if raw-SQL needs dominate

*Options:* Prisma; Drizzle; Kysely; raw SQL.
*Chosen:* Prisma.
*Why:* best-in-class migration tooling and generated types that flow into `packages/core`.
Drizzle was a close second (lighter, better raw-SQL story) but Prisma's migration ergonomics
win for a first build.
*Trade-off accepted:* Prisma cannot express partial unique indexes or `CHECK` constraints —
these are hand-written SQL inside generated migrations, and every such constraint is
documented in doc 04. Hot-path locking uses `$queryRaw`.

---

### ADR-009 — Phone OTP as the only customer auth method at MVP
**Status** ACCEPTED · **Doc** 07 §4.1

*Why:* the delivery contact is a phone number anyway, so OTP verifies it as a side effect;
it is the Indian market norm; it eliminates password storage, reset flows and credential
stuffing entirely.
*Rejected for MVP:* email/password (friction, support burden — added in P2); Google sign-in
(creates an email-without-phone identity needing a separate collection step, reintroducing
the friction we removed).

---

### ADR-010 — Two separate Firebase projects
**Status** ACCEPTED · **Doc** 07 §2 · **Security-critical**

*Options:* one project with a custom `role` claim; two projects.
*Chosen:* two.
*Why:* with one project, a customer token and an admin token are cryptographically
indistinguishable, and the only thing preventing escalation is our code reading a claim
correctly on every admin route. With two, `verifyIdToken` rejects the wrong audience before
any application logic runs. It converts "unlikely" into "impossible". It also lets admin
sign-up be disabled entirely and MFA be mandated for staff without affecting customers.
*Trade-off accepted:* two SDK initialisations and two sets of variables; a person who is both
customer and admin holds two identities, handled by `UNIQUE (firebase_uid, user_type)`.

---

### ADR-011 — Cloudflare R2 + Cloudflare Images for media
**Status** ACCEPTED · **Doc** 03 §8

*Options:* local filesystem; Vercel Blob; AWS S3 + CloudFront; Cloudflare R2.
*Chosen:* R2.
*Why:* zero egress fees (images are the dominant bandwidth cost for a food business),
S3-compatible, inside the Cloudflare account already used for DNS and CDN, with integrated
edge transforms. Local filesystem is impossible on ephemeral containers.
*Also decided:* presigned direct upload — bytes never transit our API.

---

### ADR-012 — UUIDv7 primary keys, generated in the application
**Status** ACCEPTED · **Doc** 04 §1.1

*Why:* ids appear in URLs and mobile clients, so sequential integers leak volume and invite
enumeration. UUIDv4 is random and fragments index locality on hot tables. UUIDv7 is
time-ordered: sequence-like locality with UUID opacity. Application generation allows a whole
aggregate (order + items + status + outbox event) to be constructed before commit.

---

### ADR-013 — Pincode-based serviceability, one pincode per zone
**Status** ACCEPTED · **Doc** 10 §7 · **REVISIT** at multi-zone (P3)

*Why:* deterministic, cache-friendly, instantly explainable to a customer, and requires no
geocoding. Geo-polygons are correct for dense cities where one pincode spans multiple
operational areas — that is a Phase 3 problem, and `addresses` already stores lat/long in
preparation.

---

### ADR-014 — Cash on Delivery implemented as a payment gateway adapter
**Status** ACCEPTED · **Doc** 19 §1

*Options:* `orders.is_paid` boolean; full payment model with COD as an adapter.
*Chosen:* the latter.
*Why:* modelling COD as a provider means the abstraction is exercised by real production
traffic from day one, rather than being a speculative interface that turns out not to fit.
Adding Razorpay becomes a second implementation of a proven interface, with no schema
migration and no changes to order logic.
*Trade-off accepted:* more tables than COD alone strictly requires.

---

### ADR-015 — Transactional outbox for all notifications
**Status** ACCEPTED · **Doc** 18 §2

*Options:* direct provider calls inside business logic; an external queue; a Postgres outbox.
*Chosen:* Postgres outbox with `FOR UPDATE SKIP LOCKED` dispatch.
*Why:* guarantees that a committed order has a committed event (and a rolled-back one does
not), decouples channel failures from business operations, and makes adding WhatsApp or push
a new adapter rather than an edit to order code. A broker adds operational surface for no
additional guarantee at this volume.

---

### ADR-016 — Polling for real-time at MVP; SSE later
**Status** ACCEPTED · **Doc** 14 §3.7 · **REVISIT** at P3

*Options:* polling; SSE; WebSockets; Firestore listeners.
*Chosen:* polling a lightweight `/track` endpoint every 30s while the tab is visible.
*Why:* the actual requirement is "the customer sees status changes within about a minute",
which polling satisfies with no new infrastructure, no connection management and no extra
failure mode. Order status changes a handful of times over hours. WebSockets would be
engineering for an imagined requirement. Firestore would split the source of truth across
two databases — the worst option, despite being the most "real-time".
*Upgrade path:* SSE for the admin order board first (where a live view genuinely helps),
then customer tracking if warranted.

---

### ADR-017 — PostgreSQL full-text search at MVP
**Status** ACCEPTED · **Doc** 06 §4 · **REVISIT** above ~1,000 SKUs

*Chosen:* `tsvector` (with the `simple` dictionary) plus a `pg_trgm` fuzzy fallback.
*Why:* a 60–200 SKU catalogue does not justify a second datastore to run, sync and secure.
The `simple` dictionary rather than `english` because the catalogue mixes English and
transliterated Hindi (`chaat`, `moong`), where stemming harms more than it helps. The
`SearchPort` interface makes Typesense or Meilisearch a later swap.

---

### ADR-018 — Trunk-based development, no long-lived `develop`
**Status** ACCEPTED · **Doc** 26 §1

*Why:* for a small team deploying several times a week, a permanent `develop` branch adds a
merge tax and a second integration point that routinely diverges from `main`. Per-PR preview
deployments already provide staging, and feature flags cover work that must land before it
ships.
*Revisit when:* a fixed release train becomes necessary, for example to coordinate with a
mobile app release.

---

### ADR-019 — Roles and permissions as data; permission keys as code
**Status** ACCEPTED · **Doc** 08 §1

*Why:* a `role` enum would force a deploy every time operations wants a slightly different
combination of duties, and real teams always do. Permissions stay as code because they are a
contract with the routes — inventing a permission key that no route checks would create a
false sense of control. Additive-only, with no deny rules, so effective permissions are a
single obvious query.

---

### ADR-020 — Database constraints as the primary correctness mechanism
**Status** ACCEPTED · **Doc** 31 cross-cutting invariants

*Why:* the five invariants that would damage the business — over-booking, negative stock,
duplicate deliveries, duplicate subscription orders, mismatched totals — are enforced by
`CHECK` constraints and unique indexes, not only by service-layer code. Application logic
gives the good error message; the database makes the bad state impossible. This holds under
concurrency, retries, multiple workers, future horizontal scaling, and code paths nobody has
written yet.
*Trade-off accepted:* some constraints require hand-written SQL in Prisma migrations.

---

### ADR-021 — Orders snapshot everything mutable
**Status** ACCEPTED · **Doc** 04 §1.7

*Why:* a price change or an address edit in 2027 must not rewrite a 2026 invoice. Foreign
keys are kept for joins and reporting; snapshots are kept for truth.
*Trade-off accepted:* wider tables and some duplication — which is the correct trade in a
financial record.

---

### ADR-022 — Hono over Express, Fastify, NestJS and tRPC
**Status** ACCEPTED · **Doc** 02 §3.1

*Why:* Web-standard request/response, first-class TypeScript, and `@hono/zod-openapi`
producing validation and an OpenAPI document from one schema. tRPC was rejected specifically
because it is a TypeScript-client RPC protocol, which conflicts directly with the native
mobile requirement. NestJS is more machinery than a four-context domain needs.

---

---

### ADR-023 — `cities` as a first-class, admin-managed entity
**Status** ACCEPTED (PHASE 01) · **Doc** 04 §6 · **Supersedes part of** ADR-013

PHASE 00 modelled `city` as free `TEXT` on `addresses` and `delivery_zones`, with
serviceability resolved purely from `zone_pincodes`. The business requirement clarified in
PHASE 01 — that Healthy Aahar will expand Noida → Greater Noida → Delhi → Ghaziabad →
Gurgaon, with cities switched on and off by an admin — makes that model wrong.

*Options considered:*
1. Keep `city` as text and infer the city list from distinct values on zones.
2. Introduce a `cities` table owned by the business, with pincodes belonging to a city.
3. Put a `city` enum in code.

*Chosen:* option 2.
*Why:* a free-text city cannot carry a status, cannot be activated or deactivated, and
cannot be validated — three admins would produce "Noida", "noida" and "NOIDA", and
"deactivate Delhi" would be unimplementable. Option 3 is precisely the hard-coding the
requirement forbids. A `cities` row carries `status`, `timezone`, `state` and an activation
timestamp, and turning a city off is a single admin action that takes effect immediately
across every surface with no deploy.
*Trade-off accepted:* `addresses.city` becomes `addresses.city_id` in PHASE 02, and
`delivery_zones` gains `city_id`. Both tables are empty at this point, so the cost is a
schema edit rather than a data migration.

---

### ADR-024 — `service_pincodes` replaces `zone_pincodes`; city owns the pincode, zone is assigned later
**Status** ACCEPTED (PHASE 01) · **Doc** 04 §6 · **Supersedes** the `zone_pincodes` design in PHASE 00

PHASE 00 made a pincode belong to a **delivery zone**. With cities introduced, that forces
zones to exist before serviceability can be expressed, which inverts the operational
reality: the business decides *which pincodes it serves* long before it decides *how it
routes them into delivery zones*.

*Chosen:* `service_pincodes` belongs to a `city`, carries its own `status`, and gains a
nullable `delivery_zone_id` in PHASE 06.
*Why:* it separates the two questions that were conflated — "do we deliver here?" (city and
pincode, PHASE 01) and "how do we route and price it?" (zone and slot, PHASE 06). It also
means PHASE 01 can deliver working, admin-controlled serviceability without dragging the
entire zone and slot model forward out of its phase.

*Serviceability therefore becomes a two-stage check:*

```
Stage 1 (PHASE 01)  city ACTIVE?  AND  pincode ACTIVE?     -> may we deliver here at all
Stage 2 (PHASE 06)  zone active?  AND  slot bookable?      -> when, at what fee, with capacity
```

**Stage 2 may only ever narrow Stage 1, never widen it.** A zone cannot make an inactive
pincode serviceable. This is stated as BR-SV8 and is the invariant that keeps the two stages
from disagreeing.

`UNIQUE (business_id, pincode)` is preserved from PHASE 00, so a pincode still resolves to
exactly one place per business and serviceability stays deterministic.

---

### ADR-025 — PHASE 01 ships a minimal schema slice, not an empty database
**Status** ACCEPTED (PHASE 01) · **Deviation from** doc 34 PHASE 01 ("Database: none")

The PHASE 00 roadmap deferred all models to PHASE 02. The PHASE 01 acceptance criteria then
required that city/pincode serviceability be **database-driven and not hard-coded**, and
that the Noida configuration exist as configuration rather than application logic. Those
cannot both be true of an empty database.

*Chosen:* PHASE 01 creates exactly five tables — `businesses`, `settings`, `job_runs`,
`cities`, `service_pincodes` — and nothing else. PHASE 02 adds the remaining ~40 tables from
doc 04 as originally planned.
*Why:* it is the smallest slice that makes the serviceability requirement real and testable
end to end. Shipping it without the tables would have meant either hard-coding Noida
temporarily (the exact thing the requirement forbids) or delivering a foundation whose
central claim was unverified.
*Trade-off accepted:* doc 34's PHASE 01 scope line is now inaccurate and has been corrected.

---

### ADR-026 — Slot times are bootstrap settings in PHASE 01, real rows in PHASE 06
**Status** ACCEPTED (PHASE 01) · **Doc** 10

Morning 07:00 and Evening 18:00 are launch configuration. `delivery_slots` is a PHASE 06
table, so PHASE 01 has nowhere structural to put them.

*Chosen:* store them as a `delivery.slot_templates` row in `settings`, explicitly labelled
as bootstrap data, and migrate them into `delivery_slots` in PHASE 06.
*Why:* it satisfies the requirement that 07:00 and 18:00 are configuration rather than
business rules, without inventing a competing slot table that PHASE 06 would have to
reconcile. **No runtime code reads slot times from `settings`** — nothing needs them until
PHASE 06, and reading them from there would create exactly the duplicate source of truth
this decision exists to avoid (BR-SV7).

---

### ADR-027 — Tailwind CSS 3.4 for now, not 4.x
**Status** ACCEPTED (PHASE 01) · **REVISIT** in PHASE 10 · **Deviation from** doc 03 §1

Doc 03 specified Tailwind 4.x. Tailwind 4 replaces the JavaScript config and preset model
with a CSS-first `@theme` model, which does not support the shared JS preset that
`packages/config/tailwind` uses to feed the same design tokens to three apps.

*Chosen:* Tailwind 3.4 for PHASE 01.
*Why:* the token architecture (doc 17 §10) — one JSON source feeding Tailwind, raw CSS and
later React Native — is load-bearing for design consistency and mobile reuse, and it works
cleanly with the 3.x preset model today. Adopting 4.x now would mean rewriting the token
pipeline during the foundation phase for no user-visible gain.
*Revisit:* PHASE 10, when the customer app's styling surface is largest and a migration can
be validated against real screens. Doc 03 has been corrected to say 3.4 with this note.

---

### ADR-028 — A provisioned test database, not Testcontainers
**Status** ACCEPTED (PHASE 02) · **Deviation from** doc 24 §2.3

Doc 24 specified Testcontainers for integration tests.

*Chosen:* a dedicated database (`healthy_aahar_test`) created per run on an
existing PostgreSQL, with migrations applied and `TRUNCATE ... CASCADE` between tests.
*Why:* CI already provisions a PostgreSQL service container for the migration job, so
Testcontainers would start a *second* database inside a job that already has one, paying
~30s of container startup for identical isolation. Locally, `docker compose` already runs
PostgreSQL for development. The isolation property that matters — tests never see each
other's rows and never touch the development database — is fully satisfied by a separate
database.
*Trade-off accepted:* tests require a reachable PostgreSQL rather than only a Docker
socket. In exchange the suite starts in under a second.
*Revisit if:* tests ever need a different PostgreSQL version from the one CI provisions.

---

### ADR-029 — `addresses` keeps free-text city; `delivery_zones` takes a city FK
**Status** ACCEPTED (PHASE 02) · **Refines** ADR-023 · **Doc** 04 §4.5, §6.1

ADR-023 said `addresses.city` would become `city_id` in PHASE 02. Implementing it exposed a
conflict with BR-D1: an **unserviceable address must remain saveable**, because a customer
may legitimately add an address we do not yet serve, and blocking the save is hostile. A
`NOT NULL city_id` makes that impossible.

*Chosen:*
- `addresses` keeps `city TEXT` (what the customer typed — a snapshot) **and** gains
  `city_id UUID NULL` (the resolved match). This mirrors the existing `delivery_zone_id`
  pattern exactly: cached on save, re-resolved at checkout.
- `delivery_zones` replaces `city TEXT` / `state TEXT` with `city_id NOT NULL`. A zone is
  operational; there is no "unserviceable zone" case, so the FK is unconditional and the
  city already carries the state.

*Why the asymmetry is correct:* an address is **user input** that may describe anywhere on
earth; a zone is **operational configuration** that must describe somewhere we know.

---

### ADR-030 — PHASE 02 admin authorization is a development-only bypass
**Status** SUPERSEDED (PHASE 03) · **Security-critical**

Real admin authentication (Firebase admin project + RBAC) is PHASE 03, but PHASE 02 ships
admin configuration endpoints that need *some* gate. Pretending authentication exists would
be worse than admitting it does not.

*Chosen:* a shared `ADMIN_DEV_TOKEN` compared in constant time, with three independent
guarantees that it cannot reach production:

1. `loadServerEnv()` **refuses to boot** when `ADMIN_DEV_TOKEN` is set and
   `APP_ENV=production`. The process does not start.
2. The middleware **refuses at request time** if it finds itself running in production —
   belt and braces, because the cost of being wrong is total.
3. If the token is **absent, every admin request is rejected**. The failure mode is closed,
   never open. There is no silent fallback to "allow".

*Why a shared token rather than no gate at all:* an ungated admin endpoint on a staging
host is a live data-modification surface for anyone who finds it.

*Rejected:* a hard-coded bypass flag (invisible in configuration); an IP allow-list (does
not survive a container move); disabling the routes entirely (then nothing verifies the
admin architecture works, which is a PHASE 02 acceptance requirement).

**Update (PHASE 03):** `dev-admin-auth.ts` and the `ADMIN_DEV_TOKEN` variable have been
deleted outright, exactly as planned above — not deprecated, not left as a fallback. Real
admin authentication (Firebase session cookies + RBAC, docs/07 §5, docs/08) is the only path
to `/v1/admin/*` now; see ADR-034 for the replacement and the verification it was tested
against before this bypass was removed.

---

### ADR-031 — OpenAPI via `@asteasolutions/zod-to-openapi` and our own route registry
**Status** ACCEPTED (PHASE 02) · **Refines** doc 03 §4

Doc 03 named `@hono/zod-openapi`.

*Chosen:* wrap `@asteasolutions/zod-to-openapi` (the library `@hono/zod-openapi` is itself
built on) and drive it from our existing route registry.
*Why:* the registry already carries `audience` and `permission` for every route, and asserts
at boot that no admin route is under-declared (BR-SEC12). That assertion is a real security
control. `@hono/zod-openapi` models neither field, so adopting it would have meant either
losing the boot-time check or maintaining route metadata in two places — which is exactly
the duplication the single-source-of-truth requirement forbids.
*The requirement that actually matters* — one Zod definition serving validation, the OpenAPI
document and the typed SDK — is fully satisfied. Verified structurally: the generated
request schema for `POST /v1/admin/cities` has no `status` property, which is how we know
the document reflects the code rather than a hand-written parallel.

---

### ADR-032 — Anything Prisma can model MUST be modelled in the schema
**Status** ACCEPTED (PHASE 02) · **Written in response to a real regression**

PHASE 01 created the composite foreign key
`service_pincodes(city_id, business_id) → cities(id, business_id)` in hand-written migration
SQL only. The Prisma schema modelled the relation as a plain `city_id` FK.

When `prisma migrate diff` generated the PHASE 02 migration, it reconciled the database down
to the model and **silently emitted `DROP CONSTRAINT`** — removing the guarantee that a
pincode cannot be attached to another business's city (BR-SV3). Nothing in review caught it;
an integration test did.

*The rule:* if Prisma **can** express a constraint — foreign keys, unique indexes, relations
— it **must** be expressed in `schema.prisma`, not only in SQL. Raw SQL is reserved for what
Prisma genuinely cannot model: CHECK constraints, partial indexes, generated columns, GIN
indexes and triggers.

*The safety net:* `packages/db/scripts/check-db-invariants.mjs` asserts that 30 named
un-modellable objects exist, and CI runs it after every migration. This replaces
`migrate diff --exit-code`, which cannot serve the purpose: Prisma reports the generated
`search_vector` column and the GIN indexes as permanent false-positive drift, so the check
would either always fail or always be ignored.

*Verified:* dropping the constraint makes the check fail with
`tenant isolation is NOT enforced`; restoring it makes the check pass.

---

### ADR-033 — City and pincode activation must not deadlock
**Status** ACCEPTED (PHASE 02) · **Written in response to a real design flaw**

Two guards were written independently and, together, made expansion impossible:

- `canActivateCity` required ≥ 1 **ACTIVE** pincode (so an active city always has something
  to serve — BR-SV4).
- `canActivatePincode` required the parent city to be **ACTIVE** (so an admin is not misled
  into thinking a pincode is live when the city gate overrides it).

A brand new city therefore had no path to activation at all. Caught by driving the real API,
not by reading the code.

*Chosen:* `canActivatePincode` **never blocks**. It returns a `warning` instead, and the
response's `is_serviceable` already tells the truth, because the city gate is evaluated
first (BR-SV9).
*Why this is the right direction:* an ACTIVE pincode inside an INACTIVE city is not a
dangerous state — it is simply not serviceable. Blocking it removed a legitimate ordering
(configure the pincodes, then switch the city on) for no safety gain. The city-side guard is
kept, because an ACTIVE city with nothing to serve genuinely is inconsistent.

A regression test asserts the two rules can no longer deadlock.

---

### ADR-034 — Firebase project initialisation is lazy, not eager at boot
**Status** ACCEPTED (PHASE 03) · **Written in response to a real deploy-breaking bug**

The natural place to construct the two `FirebaseTokenVerifier` instances (customer, admin) is
`createApp()`, at boot — matching this codebase's stated philosophy of failing the boot, not a
request, on bad configuration (docs/23). Building `createApp` that way and deploying it to a
Railway staging environment that has no real Firebase project yet (only placeholder project
IDs; PHASE 03 was code work, not GCP provisioning) would crash the ENTIRE API at startup —
health checks, public catalogue and serviceability endpoints included — over a configuration
gap that only auth actually needs.

*Chosen:* `FirebaseTokenVerifier.auth` is a lazy getter. Construction never touches
`firebase-admin`; the first real call (`verify`, `createSessionCookie`, …) does, and only
those call sites fail if the project is unconfigured, mapped to `503 SERVICE_UNAVAILABLE` —
not a 401 (the caller did nothing wrong) and not a process crash.
*Rejected:* eager construction (crashes unrelated endpoints on a Firebase gap); a global
try/catch around `createApp()` that swallows the error and runs with auth silently disabled
(the "no silent fallback to allow" principle from ADR-030 applies here too — the failure must
be loud on the affected routes, not invisible everywhere else).
*Verified:* `app.test.ts` boots the app with zero Firebase configuration and asserts health
and public routes return 200 while `/v1/auth/session` and `/v1/admin/auth/session` return 503.

---

### ADR-035 — `is_super_admin` is derived from holding the `SUPER_ADMIN` role, not set independently
**Status** ACCEPTED (PHASE 03) · **Refines** docs/08 §1

`admin_users.is_super_admin` is a real column (bypasses all permission checks), and `roles`
is a real table with a `SUPER_ADMIN` system role. Two independent places that could each
grant "bypass everything" is exactly the kind of duplication BR-SEC7 exists to prevent.

*Chosen:* `is_super_admin` is written ONLY as a side effect of role assignment — invite and
`setRoles` in `PrismaAdminRepository` compute it as `roles.some(r => r.key === 'SUPER_ADMIN')`
and persist that alongside the role grant, in the same transaction. There is no separate
"promote to super admin" endpoint.
*Why the column still exists rather than deriving it at read time:* the boolean is read on
every admin-authenticated request (`AdminAuthService.resolveActor`); keeping it denormalised
avoids a second join on that hot path, and the single write path keeps it impossible to drift.

---

### ADR-036 — The `__Host-` cookie prefix's own rules apply to deletion, not just creation
**Status** ACCEPTED (PHASE 03) · **Written in response to a real bug caught by the test suite**

Hono's cookie serializer enforces the `__Host-` prefix's requirements (`Secure`, `Path=/`, no
`Domain`) on every cookie it writes — including the zero-`Max-Age` cookie `deleteCookie` sends
to clear one. `POST /v1/admin/auth/logout` called `deleteCookie(c, SESSION_COOKIE, { path: '/'
})` with no `secure` flag, which is fine for *setting* a non-prefixed cookie but throws for a
`__Host-`-prefixed one, turning every logout into a 500.

*Chosen:* `deleteCookie` calls for both cookies pass the same `secure: true, sameSite:
'Strict'` attributes they were created with. *Caught by:* an integration test asserting logout
returns 200 and a subsequent request is rejected — the kind of test that only exists because
the real route was driven end to end rather than unit-tested in isolation.

---

### ADR-037 — PHASE 03 authentication is email/password with DB-backed sessions, not Firebase
**Status** ACCEPTED (PHASE 03, supersedes ADR-009 and ADR-010 for the CURRENT phase)
**Security-critical**

ADR-009 and ADR-010 committed this project to Firebase Authentication (phone OTP for
customers, email+password *inside* Firebase for admins, two separate projects for audience
separation). That design was implemented — `packages/auth`'s `FirebaseTokenVerifier`,
`FirebaseAdminSessionAdapter`, the dual-project verification, the Firebase Auth emulator in
`docker-compose.yml` — and verified end to end before this ADR.

A later architectural decision (business owner directive, not a technical failure of the
Firebase design) requires the CURRENT implementation to run on email/password credentials
owned entirely by this system, with deployment restricted to GitHub + Railway Postgres +
Vercel + local Node/pnpm — no external auth provider, no Docker in the development loop.

*Chosen:*
- `users.password_hash` (nullable, scrypt-encoded) replaces the Firebase credential as the
  login secret, verified in `packages/auth/src/password.ts`.
- A new `sessions` table (DB-backed, hashed-token) replaces both the Firebase session cookie
  (admin) and the Firebase ID-token-as-bearer pattern (customer). See ADR-038 for why the two
  audiences still differ in HOW the token travels, even though both are now DB-backed.
- `users.firebase_uid` is **not dropped** — it becomes nullable and unused by any PHASE 03 code
  path. Firebase remains a documented FUTURE option (deferred, not rejected): the column, the
  `FIREBASE_*` environment variables (now optional/unvalidated), and the architecture
  described in docs/07 §2–§3 are the reconnection point if a later phase reintroduces it. This
  is the same "no silent fallback, no blind deletion of forward-looking architecture"
  principle ADR-030 established for the PHASE 02 dev-token bypass, applied here to a
  deliberately-deferred integration rather than a deliberately-removed bypass.
- `RbacService.inviteAdmin` no longer calls an external identity provider — it creates the
  `users` row directly with no password, then issues a one-time password-setup token through
  the same mechanism (`PasswordResetRepository`) a future "forgot password" flow would use.
  Deactivation revokes every DB session for the user instead of disabling a Firebase account.
  Both are *simpler* under this design, not merely different — there is no longer an external
  service call on either path.

*Rejected:* keeping Firebase for admin only and switching customers to passwords (ADR-010's
two-Firebase-project security property depends on BOTH audiences living there; splitting them
would mean maintaining the Firebase integration for a shrinking fraction of auth while gaining
none of this phase's "no external provider" goal).

*What did NOT change:* RBAC (`packages/core/src/services/rbac-service.ts`'s invariants
BR-SEC6/7/8), the route-registry permission-enforcement layer
(`apps/api/src/middleware/require-permission.ts`), business isolation, or the `Actor` model's
shape (`AdminActor`/`CustomerActor` are structurally identical to before — only how a request
arrives at one changed).

### ADR-038 — Customer sessions stay bearer-token; admin sessions stay cookie-based
**Status** ACCEPTED (PHASE 03) · **Refines** ADR-037, docs/30 §2

Under DB-backed sessions, both audiences COULD use either transport — the Firebase-era
constraint (a browser-only SDK vs. a server-verifiable ID token) no longer applies. This ADR
is about which transport to keep anyway, now that it is a free choice.

*Chosen:* no change to either audience's transport.
- **Admin** (`apps/admin`, a browser-only console with no mobile-client future planned):
  keeps the `__Host-admin_session` `HttpOnly`, `Secure`, `SameSite=Strict` cookie, now holding
  a DB-backed opaque token instead of a Firebase session cookie. CSRF double-submit
  (`packages/auth/src/csrf.ts`) is unchanged and still required — it protects against exactly
  the same cookie-based forgery regardless of what the cookie's value means internally.
- **Customer** (`apps/customer` today; native Android/iOS explicitly planned — docs/30):
  keeps `Authorization: Bearer <token>`, cookie-free, per docs/30 §2's mobile-readiness claim
  and its own enforcement test (an integration suite driving the API with no cookies, no
  Origin header, bearer token only — "exactly a mobile client"). Moving the customer API to a
  cookie now would pass that test trivially today and then have to be undone the moment a
  native client needs the SAME endpoints, since native apps do not carry a browser's cookie
  jar. The token is returned once, in the login/register response body; the client is
  responsible for storage (web: memory; native: platform secure storage), and this API never
  persists more than the token's hash.

*Rejected:* cookies for both audiences (simpler to reason about, but revisits a decision
docs/30 already made and tested, for no PHASE-03-specific reason — the "do not store a session
token" instinct is about NOT putting it in `localStorage`/`sessionStorage`/a
JS-readable cookie, which this design already avoids by keeping it in the response body only,
not in doubling down on cookies specifically).

## Pending decisions — require the business owner

| ID | Decision | Blocks | Needed by |
|---|---|---|---|
| ~~PD-01~~ | ~~Brand name, wordmark and domain~~ | **RESOLVED (PHASE 01):** Healthy Aahar, `healthyaahar.com`, with `app.` / `admin.` / `api.` subdomains | — |
| **PD-02** | Exact serviceable pincode list | **PARTIALLY RESOLVED (PHASE 01):** launch city is Noida. The pincode list is now *admin data*, not a blocker — development seeds a representative set and the owner sets the real list in the admin panel in PHASE 04 | PHASE 04 (data entry, not code) |
| **PD-03** | Slot cutoff times | **PARTIALLY RESOLVED (PHASE 01):** windows are Morning 07:00 and Evening 18:00, stored as bootstrap settings (ADR-026). Cutoff times are still needed | PHASE 06 |
| **PD-04** | Delivery fee, free-delivery threshold, minimum order value | Zone seed data | PHASE 06 |
| **PD-05** | GST treatment — inclusive or exclusive pricing, HSN codes, invoice format | Price display, invoice generation (P2) | PHASE 07 (display), P2 (invoices) |
| **PD-06** | COD collection basis for subscriptions — per delivery or per cycle | Subscription billing model | PHASE 09 (MVP assumes per delivery) |
| **PD-07** | Refund mechanism while COD-only — cash return or credit note | Refund flow | P2 |
| **PD-08** | Subscription plan commitments — minimum duration, pause and skip limits | Plan seed data (configuration, not schema) | PHASE 09 |

## Pending decisions — deferred by design

| ID | Decision | Decide at |
|---|---|---|
| PD-09 | WhatsApp provider — Meta Cloud API or a BSP | PHASE 18 (P5) |
| PD-10 | Payment gateway — Razorpay, Cashfree or other | PHASE 17 (P4) |
| PD-11 | Mobile framework — Expo, native, or Flutter | PHASE 19 (P6) |
| PD-12 | Multi-tenant isolation policy (RLS vs schema separation) | When a second business is real |
| PD-13 | Search engine replacement | Above ~1,000 SKUs |
| PD-14 | Redis introduction (queues, distributed rate limiting) | At API horizontal scale-out |

**MVP is not blocked by any deferred decision.** PD-02 through PD-08 are seed data and
configuration — the schema accommodates any answer. Only **PD-01 blocks PHASE 01**, and only
for naming.
