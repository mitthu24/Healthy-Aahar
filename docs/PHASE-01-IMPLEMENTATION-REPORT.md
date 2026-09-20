# PHASE 01 — Implementation Report

**Brand:** Healthy Aahar · **Domain:** `healthyaahar.com` · **Launch city:** Noida
**Status:** Complete. Awaiting approval before PHASE 02.
**Every check below was executed, not asserted.** Results are reproduced verbatim.

---

## 1. What was built

A working monorepo foundation: 5 applications, 11 packages, a PostgreSQL schema slice for
admin-controlled serviceability, a running API with a real end-to-end vertical slice, a
scheduled-job worker, CI, and local infrastructure that starts with one command.

The central deliverable is not the scaffolding — it is that **serviceability is
database-driven and provably so**. Expanding from Noida to Greater Noida was demonstrated
as a row update with no deploy and no code change (§10).

### Headline numbers

| | |
|---|---|
| Applications | 5 (`marketing`, `customer`, `admin`, `api`, `worker`) |
| Packages | 11 |
| Database tables | 5 (serviceability foundation only — ADR-025) |
| Tests | **145 passing** across 8 suites (24 contracts + 95 core + 26 api) |
| Domain coverage | **99.1% statements / 93.5% branches** (gate: 90%) |
| Turborepo tasks green | lint 17/17 · typecheck 17/17 · test 17/17 · build 6/6 |
| New ADRs | 5 (ADR-023 … ADR-027) |
| New business rules | 12 (`BR-SV1` … `BR-SV12`) |

---

## 2. Repository structure

```
healthy-aahar/
├── apps/
│   ├── marketing/          Next.js 15, SSG/ISR, indexable        :3000
│   ├── customer/           Next.js 15, noindex                   :3001
│   ├── admin/              Next.js 15, noindex                   :3002
│   ├── api/                Hono — the only writer to PostgreSQL  :4000
│   └── worker/             node-cron + advisory locks            (no ingress)
├── packages/
│   ├── core/               Domain logic — pure, no I/O, no framework
│   ├── db/                 Prisma schema, migration, seed, client, health
│   ├── contracts/          Zod schemas — one definition for API + clients + OpenAPI
│   ├── auth/               Firebase verification, two separate projects
│   ├── ui/                 Design system (Button, cn, token stylesheet)
│   ├── config/             tsconfig/eslint/tailwind presets, design tokens, env schemas
│   ├── notifications/      NotificationChannel port + Noop + Capturing
│   ├── payments/           PaymentGateway port + CashOnDeliveryGateway
│   ├── storage/            StoragePort — presigned upload contract
│   ├── observability/      Pino logger with PII redaction
│   └── sdk/                Typed API client
├── docs/                   39 documents (38 architecture + this report)
├── scripts/                with-env.mjs, check-public-env.mjs, db/init, firebase/
├── tests/e2e/              Empty by design until PHASE 07 (README explains why)
├── .github/                CI workflow, PR template, CODEOWNERS
├── docker-compose.yml      Postgres ×2, MinIO, Firebase Auth emulator
├── turbo.json, pnpm-workspace.yaml, tsconfig.base.json
├── vercel.json, railway.json
└── .env.example            + one per frontend app
```

---

## 3. Agent responsibilities and what each delivered

I executed all seven agent roles **sequentially in this session** rather than spawning
parallel subagents. The reason is practical: every Phase 01 artefact is interdependent —
the workspace manifest, tsconfig graph, lint presets, Prisma client and route registry all
have to agree — and parallel agents editing one repository would have spent more effort
reconciling conflicts than doing the work. Each also would have started cold and re-read
10,700 lines of Phase 00 docs already in context here. Work below is attributed by role;
say the word and later phases can genuinely fan out, where module boundaries make it safe.

| Agent | Delivered |
|---|---|
| **0 — Lead / Architect** | Resolved the city/pincode gap against Phase 00 (ADR-023, ADR-024); scoped the schema slice (ADR-025); integration review; updated docs 03, 04, 06, 31, 34, 36 |
| **1 — DevOps / Platform** | pnpm + Turborepo workspace, Docker Compose (Postgres ×2, MinIO, Firebase emulator), CI pipeline, `vercel.json`, `railway.json`, `with-env.mjs`, env matrix |
| **2 — Backend / API** | Hono app, route registry with boot-time assertions, request-id / security-headers / CORS / rate-limit / error middleware, health + readiness, public serviceability endpoints, Prisma repository |
| **3 — Frontend Platform** | Three Next.js shells, design tokens → Tailwind preset, `packages/ui`, per-app noindex policy, robots routes, webpack/ESM resolution for workspace TS source |
| **4 — Database** | `cities` / `service_pincodes` / `businesses` / `settings` / `job_runs`, hand-written migration SQL with CHECK + composite FK, idempotent seed from JSON, health check |
| **5 — Auth / Security** | Dual Firebase verifier with cross-project guard, env schema security refinements, secret hygiene (`.gitignore`, Gitleaks, `check-public-env.mjs`), security headers |
| **6 — QA** | 145 tests, coverage gate wired into `pnpm test`, route-registry assertions, no-browser-context API suite, CI gates, constraint verification |

---

## 4. Infrastructure

### Local (verified running)

```
SERVICE           STATUS
firebase-auth     Up (auth emulator responding on :9099)
minio             Up (healthy) — bucket healthy-aahar-media-local created, HTTP 200
postgres          Up (healthy) :5432
postgres-shadow   Up (healthy) :5434
```

### Deployment configuration (written, not yet provisioned)

| Platform | Artefact | Note |
|---|---|---|
| Vercel | `vercel.json` + 3 app roots | Security headers, silent GitHub comments |
| Railway | `railway.json` | Health check `/v1/health/ready`, migrate-then-start, restart on failure |
| Cloudflare | Documented in [25-DEVOPS-DEPLOYMENT.md](25-DEVOPS-DEPLOYMENT.md) §3–4 | DNS records for all 5 hostnames |
| GitHub Actions | `.github/workflows/ci.yml` | 6 jobs: static, secrets, test, migrations, build, audit |

**Nothing has been deployed.** No Vercel project, Railway service, Firebase project or
Cloudflare zone was created — provisioning touches billing and DNS and is yours to
authorise (§13).

---

## 5. Database foundation

Five tables. Every other table in [04-DATABASE-DESIGN.md](04-DATABASE-DESIGN.md) remains
PHASE 02 (ADR-025).

| Table | Purpose |
|---|---|
| `businesses` | The operating entity; the `business_id` seam for multi-business (ADR-005) |
| `settings` | Runtime configuration, including bootstrap slot templates |
| `job_runs` | Scheduled-job execution record; powers dead-man's-switch alerting |
| `cities` | Admin-managed city with `ACTIVE` / `INACTIVE` / `COMING_SOON` |
| `service_pincodes` | Pincode owned by a city, with its own status |

Phase 00 conventions upheld: UUIDv7 application-generated keys, `TIMESTAMPTZ` in UTC,
`business_id` everywhere, native enums, no floating-point money (no money columns in this
slice), soft delete only where history requires it — cities and pincodes are **never
deleted**, only deactivated.

### Constraints — verified by execution, not assumed

| Constraint | Result |
|---|---|
| 5-digit pincode | `ERROR: violates check constraint "service_pincodes_format"` |
| Pincode with leading zero | `ERROR: violates check constraint "service_pincodes_format"` |
| Duplicate pincode per business | `ERROR: duplicate key value violates "service_pincodes_business_id_pincode_key"` |
| `ACTIVE` pincode without `activated_at` | `ERROR: violates "service_pincodes_active_requires_activated_at"` |
| `ACTIVE` city without `activated_at` | `ERROR: violates "cities_active_requires_activated_at"` |
| Blank city name | `ERROR: violates check constraint "cities_name_not_blank"` |
| Valid pincode | `INSERT 0 1` |

The composite foreign key `(city_id, business_id) → cities (id, business_id)` makes it
structurally impossible for a pincode to attach to another business's city — a plain
`city_id` FK would have allowed that, silently widening serviceability across a tenant
boundary (BR-SV3).

### Seed — idempotent, verified by running it twice

```
run 1: cities=2 pincodes=6 settings=6 → done
run 2: cities=2 pincodes=6 settings=6 → done
row counts after both: businesses=1 cities=2 service_pincodes=6 settings=6
```

`status` is written on **create only**. Re-running the seed never re-enables a pincode an
admin deliberately switched off.

---

## 6. API foundation

| Endpoint | Status |
|---|---|
| `GET /v1/health` | `{"status":"ok","version":"dev","env":"local","uptime_s":1,...}` |
| `GET /v1/health/ready` | `{"status":"ok",...,"checks":{"database":{"status":"ok","latency_ms":61,"migrations_applied":1}}}` |
| `GET /v1/public/serviceability?pincode=` | Verified across all five outcomes (§10) |
| `GET /v1/public/cities` | Returns Noida (ACTIVE) and Greater Noida (COMING_SOON) |
| `GET /v1/routes` | Route manifest with audience and required permission |

Readiness deliberately checks **migrations applied**, not just connectivity. A database that
accepts connections but has no schema is the exact failure mode of a half-finished deploy,
and a naive `SELECT 1` would report it healthy while every real request 500s.

**Cross-cutting middleware in place:** request id (accepts a validated upstream Cloudflare
id), structured logging, security headers, CORS against an explicit allow-list, per-caller
rate limiting, and an error handler mapping `ZodError` / `DomainError` / `HTTPException` to
the documented envelope. Unexpected errors return a generic message plus `request_id`; the
cause goes to logs only.

**The route registry asserts at boot** that every admin route declares a permission, that
non-admin routes declare none, that permissions are `resource:action`, that paths are
versioned, that audience matches path prefix, and that no route is registered twice. An
unguarded admin endpoint therefore fails the deploy rather than shipping (BR-SEC12). Nine
tests cover it, including that it reports *every* problem at once rather than one per
deploy attempt.

---

## 7. Frontend foundation

Three Next.js 15 / React 19 shells sharing one design-token source. Marketing renders the
serviceable-cities list **live from the API** — the deliberate proof that the vertical slice
works end to end. Customer and admin are static shells; the admin page renders the intended
module IA with phase labels.

Design tokens live as plain JSON in `packages/config/tokens/` and are compiled into a
Tailwind preset, so the same values will feed React Native later (docs/17 §10, docs/30 §8).
No component hard-codes a hex value.

`noindex` is applied on the customer and admin apps at **two layers** — `metadata.robots`
and an `X-Robots-Tag` response header — plus a `robots.ts` disallowing everything. A single
mechanism is one misconfiguration away from indexing a customer's order page (BR-SEO1).

---

## 8. Auth foundation

`FirebaseTokenVerifier` initialises **two separate Firebase apps**, one per audience
(ADR-010). Three guards were added beyond the Phase 00 design because each closes a way the
separation could silently collapse:

1. The env schema **refuses to boot** if the customer and admin project IDs are equal.
2. The verifier **rejects a service account** whose `project_id` does not match its
   configured project — catching the copy-paste error of pointing the admin verifier at
   customer credentials.
3. `verifyIdToken` is called with `checkRevoked` for admins, so deactivation ends a session
   immediately rather than up to an hour later (BR-SEC10).

Session exchange, the `Actor` model and permission resolution are PHASE 03. The `Actor` type
is already declared in the API context so handlers are written against it from the start.

---

## 9. City / pincode serviceability architecture

Phase 00 had **no `cities` entity** — `city` was free `TEXT`, and pincodes belonged to
delivery *zones*. That model cannot express "deactivate Delhi", so it was corrected rather
than worked around.

```
cities            ACTIVE | INACTIVE | COMING_SOON
  └── service_pincodes   ACTIVE | INACTIVE | COMING_SOON
        └── delivery_zones + delivery_slots   [PHASE 06]
```

**Two-stage resolution.** Stage 1 (city + pincode, PHASE 01) answers *may we deliver here at
all*. Stage 2 (zone + slot, PHASE 06) answers *when, at what fee, with what capacity*.
**Stage 2 may only narrow Stage 1, never widen it** (BR-SV8).

**City gate runs first and overrides the pincode.** Deactivating a city is sufficient on its
own — an admin who had to remember to also deactivate every pincode inside it would
eventually miss one, and that pincode would keep accepting orders into a city the business
had stopped serving (BR-SV9).

The resolver is a **pure function** with no I/O, exhaustively tested across all nine
(city status × pincode status) combinations.

### Anti-hard-coding audit

```
'Noida' in application code (excluding tests/seed):
  4 matches — all inside comments explaining that it is NOT hard-coded
pincode literals in application code:     none
slot-time literals (07:00 / 18:00):       none
city/pincode equality comparisons:        none
values actually live in:  packages/db/prisma/seed-data/bootstrap.json
```

### Proven live: expansion without a deploy

```
BEFORE  201301 → serviceable=True

>>> UPDATE cities SET status='INACTIVE' WHERE slug='noida';   (database only)
AFTER   201301 → serviceable=False  reason=CITY_INACTIVE
        "Sorry, Healthy Aahar is not currently delivering in Noida."

>>> reactivate Noida; activate Greater Noida + pincode 201310
        201301 → serviceable=True
        201310 → serviceable=True
        "Good news — Healthy Aahar delivers to Knowledge Park, Greater Noida."
```

A city that was not serviceable five seconds earlier became serviceable with no deploy, no
restart and no code change. That is the requirement, demonstrated.

**A client cannot assert serviceability.** `?is_serviceable=true&isServiceable=true` has no
effect — the parameter is never read, and the answer is recomputed from the database every
time (BR-SV1, covered by a test).

---

## 10. Serviceability responses verified

| Input | Result |
|---|---|
| `201301` — ACTIVE city, ACTIVE pincode | `is_serviceable: true`, area "Sector 1-18" |
| `201305` — ACTIVE city, INACTIVE pincode | `false`, `PINCODE_INACTIVE`, *"not delivering to 201305 yet. We deliver elsewhere in Noida."* |
| `201310` — COMING_SOON city | `false`, `CITY_COMING_SOON`, waitlist offered |
| `560076` — never registered | `false`, `PINCODE_NOT_FOUND`, generic refusal |
| `abc` — malformed | `422 VALIDATION_FAILED` with field detail and `request_id` |

Non-serviceable returns **HTTP 200**, not 404 — the question was answered successfully
(BR-SV11). The distinction between "no" and "not yet" is preserved, because one is a refusal
and the other is a waitlist opportunity.

---

## 11. Delivery-slot configuration architecture

Morning 07:00 and Evening 18:00 are stored as a `delivery.slot_templates` row in `settings`,
explicitly labelled bootstrap data, and migrate into `delivery_slots` in PHASE 06
(ADR-026). **No runtime code reads slot times from `settings`** — nothing needs them until
PHASE 06, and reading them from there would create the duplicate source of truth the
decision exists to avoid (BR-SV7).

`businessDateTimeToUtc()` — the primitive PHASE 06 builds `cutoff_at` on — is implemented and
tested against the real configured times: 07:00 IST → `01:30Z`, 18:00 IST → `12:30Z`,
22:00 IST → `16:30Z`.

---

## 12. Tests, CI and security

**145 tests, 8 suites, all passing** (verified with a forced, non-cached Turborepo run — `npx turbo run test --force`). Domain coverage 99.1% statements / 93.5% branches
against a 90% gate that now actually runs (it was configured but not wired into
`pnpm test` — a threshold that never executes reads like a guarantee and enforces nothing).

| Suite | Covers |
|---|---|
| `serviceability.test.ts` | All 9 city × pincode combinations, message copy, activation guards |
| `money.test.ts` | Indian lakh formatting, exact integer arithmetic, half-up rounding, float rejection |
| `time.test.ts` | IST/UTC boundaries, slot-time conversion, month/leap-year edges, injected clock |
| `ids.test.ts` | UUIDv7 validity, uniqueness, **time-ordering**, v4 discrimination, DomainError |
| `serviceability-service.test.ts` | Service against an in-memory fake, checkout guard |
| `contracts.test.ts` | Schemas, error catalogue, *pincode regex matches the DB CHECK exactly* |
| `route-registry.test.ts` + `app.test.ts` | Boot assertions, endpoints, headers, CORS |

`app.test.ts` drives the API with **no cookies and no `Origin` header** — exactly how a
native mobile client will call it. This makes the mobile-readiness claim falsifiable now
rather than a PHASE 19 discovery (docs/30 §10).

**CI:** 6 jobs — static (format/lint/types), secret scanning (Gitleaks + public-env guard),
tests, migrations (applies to empty DB, drift check, **seed run twice**), build, audit.

**Security posture:** no secrets committed; `.gitignore` covers `*-service-account*.json`
and all `.env` variants; `check-public-env.mjs` passes; security headers on every API
response; CORS rejects unlisted origins (verified); PII redaction allow-list in the logger;
least-privilege DB role documented for PHASE 02.

---

## 13. Deviations from Phase 00

Each is recorded as an ADR with reasoning, not silently applied.

| # | Deviation | Why | Record |
|---|---|---|---|
| 1 | `cities` introduced as a first-class entity | Phase 00 had no city entity; admin city management is impossible without one | ADR-023 |
| 2 | `zone_pincodes` → `service_pincodes`, owned by city | Pincode-belongs-to-zone forces zones to exist before serviceability can be expressed | ADR-024 |
| 3 | PHASE 01 ships 5 tables, not zero | Acceptance criteria 27–29 require DB-driven serviceability; an empty database cannot satisfy them | ADR-025 |
| 4 | Slot times as `settings` bootstrap data | `delivery_slots` is a PHASE 06 table | ADR-026 |
| 5 | Tailwind 3.4 instead of 4.x | Tailwind 4 drops the JS preset model that feeds one token source to three apps and later React Native | ADR-027 |

Docs corrected in the same pass: **03** (Tailwind version), **04** (§6 rewritten), **06**
(serviceability endpoints §4, §11.7a), **31** (new §D0, BR-D2 amended), **34** (PHASE 01
database scope), **36** (5 ADRs, PD-01 resolved, PD-02/PD-03 partially resolved).

---

## 14. Known issues and limitations

| # | Item | Impact | Plan |
|---|---|---|---|
| 1 | Nothing is deployed | No staging URL exists | Needs your authorisation (§16) |
| 2 | `@hono/zod-openapi` not yet wired; `/v1/openapi.json` not served | SDK is hand-written, not generated | PHASE 02 |
| 3 | Rate limiter is in-process | Correct for one instance only | Redis at horizontal scale-out (PD-14) |
| 4 | No integration tests against a real database | Constraints verified manually this phase | Testcontainers harness, PHASE 02 |
| 5 | `docker compose up` needs `quay.io/minio/*` | Docker Hub denied `minio/mc` on this machine | Already switched to quay.io; both pull cleanly |
| 6 | Firebase emulator runs one project | Both project IDs point at one emulator locally | Acceptable — real separation is enforced in deployed environments; revisit in PHASE 03 |
| 7 | Seed pincodes are representative, not real | Development data only | You set the real list in admin (PHASE 04) |
| 8 | `tests/e2e/` is empty | No journey exists to test | PHASE 07, explained in its README |

---

## 15. Acceptance criteria

| # | Criterion | Result |
|---|---|---|
| 1 | `pnpm install` works | ✅ 800 packages, clean |
| 2 | Turborepo works | ✅ 17 tasks orchestrated with caching |
| 3 | Marketing builds | ✅ |
| 4 | Customer builds | ✅ |
| 5 | Admin builds | ✅ |
| 6 | API builds | ✅ |
| 7 | Worker builds | ✅ (6/6 build tasks) |
| 8 | TypeScript passes | ✅ 17/17 |
| 9 | Lint passes | ✅ 17/17 |
| 10 | Tests pass | ✅ 145 tests, 17/17 tasks |
| 11 | Docker starts | ✅ 4 services |
| 12 | PostgreSQL starts | ✅ primary + shadow, both healthy |
| 13 | MinIO starts | ✅ healthy, bucket created, HTTP 200 |
| 14 | Firebase emulator starts | ✅ responds on :9099 |
| 15 | API health endpoint works | ✅ `/v1/health` and `/v1/health/ready` |
| 16 | Database connectivity check works | ✅ reports latency and migrations applied |
| 17 | Environment configuration documented | ✅ `.env.example` ×4, doc 27, boot validation |
| 18 | No secrets committed | ✅ Gitleaks in CI, public-env guard passes |
| 19 | GitHub CI passes | ⚠️ Workflow written; every job verified locally. Not yet run on GitHub (no remote) |
| 20 | Vercel foundation configured | ⚠️ `vercel.json` + app roots written; projects not created |
| 21 | Railway foundation configured | ⚠️ `railway.json` written; services not created |
| 22 | Cloudflare architecture configured/documented | ✅ Documented (doc 25 §3–4); zone not provisioned |
| 23 | Customer/admin Firebase separation exists | ✅ Two projects, enforced by env schema + verifier |
| 24 | Repo can be cloned and started by another developer | ✅ README path; verified from a clean install |
| 25 | No out-of-phase business logic | ✅ No catalogue, cart, order, subscription or inventory code |
| 26 | Serviceability architecture documented | ✅ ADR-023/024, doc 04 §6, BR-SV1–12 |
| 27 | Serviceability is database-driven | ✅ Proven live (§9) |
| 28 | Noida config is configuration, not logic | ✅ `bootstrap.json`; audit shows zero hard-coded values |
| 29 | 07:00 / 18:00 are configuration | ✅ `settings` bootstrap; no code reads them |
| 30 | Documentation audit passes | ✅ Docs 03/04/06/31/34/36 updated in the same pass |

**26 fully met, 4 partially met.** The four marked ⚠️ are all the same thing: the
configuration exists and is verified, but provisioning a Vercel/Railway/Cloudflare/GitHub
account touches billing, DNS and your credentials. That is a decision for you, not
something to do unasked.

---

## 16. What I need from you

| # | Decision | Blocks |
|---|---|---|
| 1 | **Create the GitHub remote** and push, so CI runs for real | Criterion 19 |
| 2 | **Provision Vercel / Railway / Cloudflare / Firebase** (or authorise me to) | Criteria 20–22, staging URLs |
| 3 | **Real Noida pincode list** — which pincodes are genuinely serviceable | Admin data entry, PHASE 04 |
| 4 | **Slot cutoff times** — by when must an order be placed for the 07:00 and 18:00 slots? | PHASE 06 (PD-03) |
| 5 | Delivery fee, free-delivery threshold, minimum order value | PHASE 06 (PD-04) |
| 6 | GST treatment — inclusive or exclusive pricing, HSN codes | PHASE 07 display (PD-05) |

None of 3–6 blocks PHASE 02. They are data and configuration; the schema accommodates any
answer, which is the practical test of whether "nothing hard-coded" was actually achieved.

---

## 17. Next phase

**PHASE 02 — Database & API Foundation.** Not started; awaiting your approval.

Scope per [34-PHASED-ROADMAP.md](34-PHASED-ROADMAP.md): the remaining ~40 tables from doc
04, every enum and index, hand-written SQL for partial uniques and CHECK constraints,
`packages/contracts` expansion, `@hono/zod-openapi` wiring with `/v1/openapi.json`, the
Testcontainers integration harness, and tests proving the database rejects each of the five
cross-cutting invariants in doc 31.

**Stopping here as instructed.**
