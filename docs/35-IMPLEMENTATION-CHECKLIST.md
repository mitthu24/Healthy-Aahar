# 35 — Implementation Checklist

Execution tracker. Each phase's items become GitHub issues at the start of that phase.
Tick items only when they are **done and verified**, not when they are written.

---

## PHASE 00 — Documentation & Architecture
- [x] 38 documents written and cross-referenced
- [x] Database schema fully specified
- [x] API surface fully specified
- [x] All architectural decisions recorded as ADRs
- [x] MVP scope fixed
- [x] Roadmap with acceptance criteria per phase
- [x] Documentation consistency audit (doc 38)
- [ ] **Owner approval to begin PHASE 01**
- [ ] PD-01 answered: brand name and domain

---

## PHASE 01 — Repository & Infrastructure
### Repository
- [ ] `pnpm-workspace.yaml`, root `package.json`, `turbo.json`
- [ ] `packages/config`: tsconfig, eslint (flat), prettier, tailwind presets, env schema
- [ ] `apps/marketing`, `apps/customer`, `apps/admin` — Next.js 15 scaffolds
- [ ] `apps/api` — Hono scaffold with `/v1/health`
- [ ] `apps/worker` — scaffold with a no-op job
- [ ] `packages/`: core, db, contracts, auth, ui, notifications, payments, storage,
      observability, sdk — empty but wired
- [ ] `eslint-plugin-boundaries` enforcing the layer dependency rule
- [ ] Husky + lint-staged + commitlint + Gitleaks pre-commit

### Local environment
- [ ] `docker-compose.yml`: Postgres 16, MinIO, Firebase Auth emulator
- [ ] `.env.example` for every app
- [ ] `pnpm dev` starts all five services
- [ ] README with a 15-minute setup path

### CI/CD
- [ ] `.github/workflows/ci.yml` — lint, typecheck, test, build, security
- [ ] Branch protection on `main`; PR template; CODEOWNERS
- [ ] Turborepo remote cache
- [ ] Vercel projects ×3 with correct root directories and regions
- [ ] Railway project: api, worker, postgres (staging)
- [ ] Deploy-on-merge verified for all five services

### External accounts
- [ ] Domain registered; Cloudflare nameservers active
- [ ] DNS records for `@`, `www`, `app`, `admin`, `api`, `cdn`
- [ ] Firebase projects ×2 (staging)
- [ ] Cloudflare R2 bucket + custom domain
- [ ] Brevo account; sender domain started
- [ ] Sentry projects ×5
- [ ] GitHub repository with issue labels

**Acceptance** — [ ] Merge to `main` deploys everything to staging; `api.staging/v1/health`
returns 200 and reaches Postgres over the private network.

---

## PHASE 02 — Database & API Foundation
- [ ] Prisma schema: all tables from doc 04
- [ ] All enums created
- [ ] Hand-written SQL for partial unique indexes, `CHECK` constraints, generated columns
- [ ] `products.search_vector` generated column + GIN index
- [ ] `pgcrypto`, `pg_trgm`, `citext`, `btree_gin` extensions
- [ ] All indexes from doc 04 §13
- [ ] `order_number` and `subscription_number` sequences
- [ ] Seeds: `dev`, `test`, `production-minimal`
- [ ] `packages/contracts`: Zod schemas, DTOs, error codes
- [ ] `packages/core`: money, time, errors, result types
- [ ] Middleware: request id, logging, CORS, error mapping, rate limit, idempotency
- [ ] Route registry with boot-time audience/permission assertion
- [ ] OpenAPI generation at `/v1/openapi.json`
- [ ] Testcontainers harness with per-test transaction rollback
- [ ] Least-privilege database role; `audit_logs` append-only grant

**Acceptance** — [ ] Each of the five cross-cutting invariants (doc 31) has a test proving
the **database** rejects the bad case. [ ] A route without an audience fails at boot.

---

## PHASE 03 — Authentication & RBAC
- [ ] `packages/auth`: dual verifiers, `Actor`, permission resolution + cache + invalidation
- [ ] `POST /v1/auth/session`, `GET /v1/auth/me`, logout
- [ ] `POST /v1/admin/auth/session` with `__Host-` cookie, CSRF token, idle timeout
- [ ] Seed 7 roles and the full permission catalogue
- [ ] Super-admin bootstrap script
- [ ] Admin invitation flow (Firebase user + Brevo reset email)
- [ ] Customer OTP sign-in UI with App Check
- [ ] Admin sign-in UI
- [ ] `audit_logs` writer helper used by every mutation
- [ ] Deactivation revokes Firebase refresh tokens

**Acceptance** — [ ] Critical scenarios 1–9 pass. [ ] The generated role × endpoint matrix
test covers every route.

---

## PHASE 04 — Admin Shell
- [ ] Layout, navigation, permission-gated menu
- [ ] `DataTable` with sort, filter, cursor pagination, bulk select
- [ ] `FilterBar`, `StatusPill`, `StatCard`, `ConfirmDialog`, `AuditDiff`, `PermissionGate`
- [ ] Toasts, error boundaries, loading states
- [ ] Admin users screen; roles screen (Super Admin only); audit log viewer; settings screen
- [ ] Command palette (Cmd/Ctrl+K)

**Acceptance** — [ ] An admin manages staff and roles and every action is visible in the
audit log with a before/after diff.

---

## PHASE 05 — Catalogue & Combos
- [ ] Category CRUD + reorder + 2-level enforcement
- [ ] Product CRUD with tabs; draft/publish workflow with validation
- [ ] Variant inline grid
- [ ] Image presign → upload → confirm → worker validation (magic bytes, dimensions, EXIF,
      LQIP) → `READY`
- [ ] Tags and dietary tags
- [ ] Combo CRUD with live price calculator and admin warnings
- [ ] Public catalogue endpoints with filters, sort, cursor pagination
- [ ] Search: full text + `pg_trgm` fallback with `match_type`
- [ ] Derived combo availability
- [ ] `packages/ui` commerce components
- [ ] `cost_paise` exclusion at the DTO layer + test across all endpoints

**Acceptance** — [ ] Publish a product and see it in the public API. [ ] Critical scenarios
10–17 pass.

---

## PHASE 06 — Delivery Zones & Slots
- [ ] Zone CRUD + pincode manager with bulk paste
- [ ] Slot CRUD with a live cutoff preview
- [ ] Slot-zone assignments
- [ ] Holiday management with an existing-orders warning
- [ ] `slot_capacity` model; capacity calendar with override and block
- [ ] `roll-slot-capacity` job with advisory lock, idempotent
- [ ] Availability algorithm with all 8 rejection reasons
- [ ] `/v1/public/serviceability`, `/v1/me/delivery-slots`
- [ ] `SlotPicker` / `SlotCard`
- [ ] Worker service live with `job_runs` and dead-man's switch alerts

**Acceptance** — [ ] Critical scenarios 18–24 pass. [ ] Capacity rows exist for the full
horizon and the job is safely re-runnable.

---

## PHASE 07 — Cart, Checkout & Orders
- [ ] Cart CRUD, guest merge, live re-pricing, `issues[]` with all codes
- [ ] `POST /v1/me/cart/validate`
- [ ] Order state machine in `packages/core` (data-driven transition table)
- [ ] `POST /v1/me/orders` — full transaction with fixed lock ordering
- [ ] `expected_total_paise` assertion
- [ ] Idempotency on order placement
- [ ] Combo explosion into parent + component lines
- [ ] `payments` row (COD adapter) created with every order
- [ ] Order history, detail, `/track`, cancel, reorder
- [ ] Admin: order list, detail, transitions, bulk, cancel, notes
- [ ] Prep list and dispatch manifest (print-friendly)
- [ ] COD collection action
- [ ] `auto-confirm-orders` job
- [ ] Customer checkout UI (single page, three sections)

**Acceptance** — [ ] Critical scenarios 25–38 pass. [ ] **Every concurrency test in doc 24 §5
passes.** [ ] 20 parallel orders on a capacity-5 slot yield exactly 5.

---

## PHASE 08 — Inventory
- [ ] Inventory + movements model wired into the order lifecycle
- [ ] Reservation, consumption, release, wastage
- [ ] Admin inventory list with derived status
- [ ] Bulk morning stock entry; one-tap out-of-stock
- [ ] Movement history view
- [ ] Low-stock and subscription-at-risk alerts
- [ ] Nightly ledger reconciliation job

**Acceptance** — [ ] Critical scenarios 56–60 pass. [ ] Ledger sum equals on-hand for every
variant after a simulated day.

---

## PHASE 09 — Subscription Engine
- [ ] Plan + plan item CRUD with the rules block
- [ ] `recurrence.ts` with full unit coverage including month-end clamping
- [ ] Subscription creation with price locking and inline first generation
- [ ] `generate-subscription-deliveries` with watermark + `ON CONFLICT DO NOTHING`
- [ ] `materialise-subscription-orders` with locking, retry, and past-cutoff `FAILED`
- [ ] Pause (with `affected_orders[]`), auto-resume job, resume
- [ ] Skip / unskip with deadline enforcement
- [ ] Change quantity, slot, address, days with `effective_from_date`
- [ ] Cancel with `min_duration_days` enforcement
- [ ] `subscription_events` log
- [ ] `send-delivery-reminders` job with `reminder_sent_at`
- [ ] Customer subscription screens with the API-driven `rules` block
- [ ] Admin subscription module with the exceptions tab and retry action

**Acceptance** — [ ] Critical scenarios 39–55 pass. [ ] All 18 edge cases in doc 32 §E behave
as specified. [ ] Concurrent generators and materialisers produce no duplicates.

---

## PHASE 10 — Customer App Completion
- [ ] Home with all rails and the next-delivery card
- [ ] Categories, listing with filters and infinite scroll
- [ ] Product detail with nutrition, allergens, prep and storage
- [ ] Favourites, profile, addresses, notification centre, search UI
- [ ] Empty, loading and error states for every screen
- [ ] Error-code → copy mapping in one module
- [ ] Accessibility pass (WCAG 2.2 AA)
- [ ] PWA manifest, icons, offline shell
- [ ] Responsive polish at 375/768/1024

**Acceptance** — [ ] E2E journeys 1–6 and 12 pass. [ ] First order under 90 seconds on
mobile. [ ] Lighthouse budgets met.

---

## PHASE 11 — Notifications
- [ ] `NotificationChannel` port + registry
- [ ] In-app adapter; Brevo adapter; `NoopChannel`; `CapturingChannel`
- [ ] Outbox dispatcher with `SKIP LOCKED`, backoff, `DEAD` handling
- [ ] Routing table for all events in doc 18 §4
- [ ] Brevo templates + required-variable CI assertion
- [ ] Brevo webhook → `notification_logs`, bounce suppression
- [ ] Recipient redaction in logs
- [ ] Admin notification log per customer
- [ ] Outbox depth and age monitoring

**Acceptance** — [ ] Critical scenarios 61–65 pass. [ ] A Brevo outage delays but never loses
a notification and never affects an order. [ ] Staging provably sends nothing.

---

## PHASE 12 — Marketing Website
- [ ] All routes from doc 16 §3
- [ ] Homepage with the pincode checker as the hero element
- [ ] Live catalogue, combo and plan pages via ISR
- [ ] On-demand revalidation webhook from admin publish
- [ ] Static content pages; legal pages
- [ ] Contact form → Brevo; waitlist capture for unserviceable pincodes
- [ ] Cross-domain handoff with `ref` only (no PII)
- [ ] API-down fallback to cached content

**Acceptance** — [ ] E2E journey 11 passes. [ ] Publishing a product appears on the marketing
site immediately via the webhook.

---

## PHASE 13 — SEO, Performance & Hardening
### SEO
- [ ] `generateMetadata` on every route; OG and Twitter cards
- [ ] JSON-LD: Organization, LocalBusiness, Product+Offer, ItemList, BreadcrumbList, FAQPage
- [ ] Sitemap index + per-type sitemaps; robots.txt per surface
- [ ] Canonicals; `noindex` on app and admin at **both** app and edge
- [ ] Search Console and Bing verified

### Performance
- [ ] Image pipeline verified (AVIF, sizes, LQIP, dimensions)
- [ ] Bundle budgets met; analyzer gate in CI
- [ ] Caching layers configured and verified
- [ ] `EXPLAIN` review of every hot-path query
- [ ] Lighthouse CI gate
- [ ] k6 load tests: browse, concurrent checkout, materialisation

### Security
- [ ] Security headers + CSP (report-only → enforced)
- [ ] CORS locked to production origins
- [ ] Rate limits tuned and verified
- [ ] Cloudflare WAF, rate limiting, Access on `admin.`
- [ ] Full doc 23 §15 checklist
- [ ] Authorization matrix test complete
- [ ] `pnpm audit`, CodeQL, Gitleaks clean

### Operations
- [ ] Sentry alerts for all P0/P1 conditions
- [ ] Dead-man's switches for all five jobs
- [ ] Uptime checks (Cloudflare + external)
- [ ] Daily `pg_dump` to R2 verified
- [ ] **Restore test performed successfully**
- [ ] **Rollback rehearsed successfully**
- [ ] Admin job-health screen

**Acceptance** — [ ] All budgets met, all controls verified, restore and rollback both
performed at least once.

---

## PHASE 14 — Launch
- [ ] Production Firebase projects ×2 with App Check
- [ ] Brevo sender domain verified; SPF, DKIM, DMARC passing
- [ ] Production database; migrations applied; PITR verified
- [ ] Seed: business, zone, pincodes, slots, holidays, roles, super admin
- [ ] Real catalogue loaded with photography and nutrition data
- [ ] All environment variables set across Vercel, Railway and GitHub
- [ ] DNS cutover; TLS and HSTS verified
- [ ] Full launch checklist (doc 25 §14)
- [ ] Admin team trained; printed-manifest dry run completed
- [ ] Legal pages published
- [ ] Soft launch to a small group
- [ ] First real order delivered end to end
- [ ] **Public launch**

---

## Continuous — every phase
- [ ] `/docs` updated in the same PR as any contract change
- [ ] New business rules added to doc 31
- [ ] New edge cases added to doc 32
- [ ] New architectural decisions recorded as ADRs in doc 36
- [ ] Tests added for new behaviour before merge
- [ ] No permission-less admin route
- [ ] No business logic in a React component
- [ ] No float used for money
- [ ] No PII in a log line
