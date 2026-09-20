# 02 — System Architecture

## 1. Architectural principles

1. **API-first.** Every capability is an HTTP endpoint before it is a screen. No business
   logic lives in a React component or a Next.js server action that a mobile app cannot call.
2. **One writer.** Only the API service talks to PostgreSQL. Frontends never hold a DB
   connection string. This is what makes the mobile app a first-class client rather than an
   afterthought.
3. **Domain logic in a framework-free package.** `packages/core` contains order, slot,
   subscription, pricing and inventory logic as plain TypeScript. It can be executed from an
   HTTP handler, a cron worker, a test, or a future queue consumer.
4. **Events, not call chains.** Side effects (email, WhatsApp, push, analytics) subscribe to
   domain events through an outbox. Adding a channel never touches order code.
5. **Ports and adapters at every external boundary.** Payments, email, storage, SMS and
   WhatsApp are interfaces with swappable implementations.
6. **The database is the source of truth, and it enforces its own invariants.** Uniqueness,
   capacity and state are protected by constraints and transactions, not by hope.
7. **Boring, observable, reversible.** Prefer the simplest technology that meets the
   requirement; instrument it; be able to roll it back.

## 2. Runtime topology

```
                             ┌──────────────────────────┐
                             │        Cloudflare        │
                             │  DNS · WAF · CDN · Rate  │
                             │  limit · Bot mgmt · TLS  │
                             └────────────┬─────────────┘
              ┌───────────────────────────┼───────────────────────────┐
              │                           │                           │
   maindomain.com              app.maindomain.com          admin.maindomain.com
   ┌──────────────────┐        ┌──────────────────┐        ┌──────────────────┐
   │  apps/marketing  │        │  apps/customer   │        │   apps/admin     │
   │  Next.js (SSG/   │        │  Next.js (CSR +  │        │  Next.js (CSR,   │
   │  ISR) on Vercel  │        │  RSC) on Vercel  │        │  SPA-ish) Vercel │
   └────────┬─────────┘        └────────┬─────────┘        └────────┬─────────┘
            │  HTTPS + Bearer (or anon) │                           │
            └───────────────┬───────────┴───────────────┬───────────┘
                            │                           │
                     api.maindomain.com  ◄── future: Android / iOS apps
                   ┌─────────────────────────────────────────┐
                   │        apps/api  ·  Hono + TS           │
                   │  Railway service, always-on container   │
                   │  ┌───────────────────────────────────┐  │
                   │  │ HTTP layer: routing, auth, Zod,   │  │
                   │  │ rate limit, error mapping, OpenAPI│  │
                   │  ├───────────────────────────────────┤  │
                   │  │ packages/core — domain services   │  │
                   │  │ order · slot · subscription ·     │  │
                   │  │ pricing · inventory · cart        │  │
                   │  ├───────────────────────────────────┤  │
                   │  │ packages/db — Prisma repositories │  │
                   │  └───────────────────────────────────┘  │
                   └──────┬───────────────────┬──────────────┘
                          │                   │
          ┌───────────────▼─────┐   ┌─────────▼───────────────────┐
          │  PostgreSQL 16      │   │  apps/worker (Railway)      │
          │  Railway, private   │◄──┤  node-cron scheduler +      │
          │  network            │   │  outbox dispatcher          │
          └─────────────────────┘   └─────────┬───────────────────┘
                                              │
   ┌──────────────┬───────────────────┬───────┴────────┬──────────────────┐
   │ Firebase Auth│   Brevo (email)   │ Cloudflare R2  │ Future: Razorpay │
   │ (2 projects) │                   │ + Images CDN   │ WhatsApp · Push  │
   └──────────────┴───────────────────┴────────────────┴──────────────────┘
```

## 3. The central decision: where does the backend live?

This is the decision that determines whether the mobile app is easy or painful, so it is
made explicitly. Full record: **ADR-002**.

### Option A — Next.js route handlers inside each frontend app
Each app owns its own API routes on Vercel.

- ✅ One framework, one deploy, fastest to start.
- ❌ Three copies of auth/validation or a shared package imported three ways.
- ❌ The mobile app has no natural base URL — it would have to call `app.maindomain.com/api`,
  a *frontend* host, which couples the mobile release cycle to a web deployment.
- ❌ Serverless + Postgres = connection-pool management (PgBouncer/Prisma Accelerate) and
  cold starts on the checkout path.
- ❌ No durable process for the subscription scheduler; Vercel Cron gives at-least-once HTTP
  invocations with an execution-time ceiling — workable but constraining for nightly batch.

### Option B — a separate always-on API service (**chosen**)
A single `apps/api` service on Railway, in the same private network and region as Postgres,
published at `api.maindomain.com`.

- ✅ One authoritative API surface for web today and mobile tomorrow. The mobile app ships
  against the same base URL and the same OpenAPI contract.
- ✅ Persistent process: a real connection pool, no cold start on checkout, in-process
  caching, and a natural home for the cron scheduler and outbox dispatcher.
- ✅ Co-located with the database: sub-millisecond DB latency over the Railway private
  network instead of cross-cloud round trips.
- ✅ Clean security boundary: the DB is reachable only from Railway's private network; no
  frontend deployment ever holds `DATABASE_URL`.
- ❌ One more service to deploy and monitor.
- ❌ CORS must be configured deliberately (a benefit disguised as a cost — it forces an
  explicit origin allow-list).

### Option C — separate backend on a heavier platform (NestJS on AWS/Fly, GraphQL, etc.)
Rejected as over-engineering for the team size and traffic profile. Revisit only if we
outgrow a single container.

**Decision: Option B.** `api.maindomain.com` is a real, dedicated origin, and it is
necessary — not because the web needs it, but because the mobile app, the marketing site
build, and the scheduler all need a stable, front-end-independent contract.

### 3.1 Why Hono for the API

| Candidate | Verdict |
|---|---|
| **Hono** | ✅ Chosen. Tiny, fast, Web-standard `Request`/`Response`, first-class TypeScript, `@hono/zod-openapi` gives typed routes *and* generated OpenAPI from the same Zod schemas we already use for validation. Runs on Node today, portable to edge runtimes later. |
| Express | Mature but untyped, middleware-typing pain, no OpenAPI story without extra tooling. |
| Fastify | Excellent and fast; schema-first with JSON Schema rather than Zod, which would mean two schema languages between frontend and backend. |
| NestJS | Powerful DI and structure, but heavy decorators/boilerplate for a 4-module domain; slower cold start and steeper onboarding. |
| tRPC | Superb DX for a TypeScript-only web client, but it is an RPC protocol, not a documented HTTP API. Native mobile (Kotlin/Swift) clients would need a bespoke client or a parallel REST layer. Rejected — it directly conflicts with the mobile-readiness requirement. |

## 4. Layered design inside the API

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Transport      apps/api/src/routes/**                    │
│    Hono routes, Zod request/response schemas, OpenAPI tags. │
│    Zero business logic. Maps DomainError → HTTP status.     │
├─────────────────────────────────────────────────────────────┤
│ 2. Context        apps/api/src/middleware/**                │
│    requestId, auth (Firebase verify), actor resolution,     │
│    permission guard, rate limit, idempotency, logging.      │
├─────────────────────────────────────────────────────────────┤
│ 3. Application    packages/core/src/services/**             │
│    Use cases: placeOrder, reserveSlot, generateDeliveries,  │
│    pauseSubscription, adjustStock. Owns transactions.       │
├─────────────────────────────────────────────────────────────┤
│ 4. Domain         packages/core/src/domain/**               │
│    Pure rules: order state machine, slot eligibility,       │
│    recurrence expansion, pricing/money, cart totals.        │
│    No I/O. 100% unit-testable.                              │
├─────────────────────────────────────────────────────────────┤
│ 5. Persistence    packages/db/src/**                        │
│    Prisma client, repositories, migrations, seeds.          │
├─────────────────────────────────────────────────────────────┤
│ 6. Ports          packages/notifications, packages/payments,│
│    packages/storage — interfaces + adapters.                │
└─────────────────────────────────────────────────────────────┘
```

**Dependency rule:** arrows point downward only. `domain` imports nothing from the layers
above it. A violation is a CI failure (enforced by `eslint-plugin-boundaries`).

## 5. Bounded contexts

| Context | Owns | Key invariants |
|---|---|---|
| **Identity** | users, customer_profiles, admin_users, roles, permissions | One app user per Firebase UID per audience |
| **Catalogue** | categories, products, variants, images, combos, tags | A purchasable line always resolves to a variant |
| **Inventory** | inventory, inventory_movements | available = on_hand − reserved, never negative |
| **Fulfilment** | zones, slots, slot_capacity, holidays | Bookings per (slot, date) ≤ capacity |
| **Ordering** | carts, orders, order_items, status history | Status transitions follow the state machine only |
| **Subscription** | plans, subscriptions, subscription_items, deliveries | One delivery per (subscription, date), exactly once |
| **Payment** | payments, payment_attempts, refunds | Order total = sum of captured payments + due |
| **Engagement** | notifications, outbox, templates, preferences | Every event produces at most one delivery per channel |
| **Governance** | audit_logs, settings, feature flags | Every admin mutation is attributable |

Contexts are packages/modules inside one deployable, **not** microservices. They are
separated so that *if* one ever needs to split out, the seam already exists.

## 6. Request lifecycle — worked example: `POST /v1/orders`

```
 1. Cloudflare      TLS, WAF, bot check, edge rate limit (per IP)
 2. Railway ingress → Hono app
 3. middleware/requestId        attach x-request-id, start structured log
 4. middleware/cors             origin must be in ALLOWED_ORIGINS
 5. middleware/auth             verify Firebase ID token (cached JWKS),
                                load users row by firebase_uid → Actor
 6. middleware/rateLimit        per-user token bucket for write endpoints
 7. middleware/idempotency      look up Idempotency-Key; replay stored
                                response if the key was already completed
 8. route handler               Zod-parse body → typed command
 9. core/services/placeOrder    BEGIN TX
                                a. load + lock cart
                                b. re-price every line from live catalogue
                                c. validate zone serviceability + min order
                                d. SELECT ... FOR UPDATE slot_capacity row,
                                   assert booked < capacity, increment
                                e. reserve inventory per variant
                                f. insert order + order_items + status row
                                g. insert payment (COD, status DUE)
                                h. insert outbox event ORDER_PLACED
                                i. mark idempotency key completed
                                COMMIT
10. response                    201 + Order resource
11. worker (async)              outbox → notification service → Brevo email
                                + in-app notification row
```

Every failure at step 9 aborts the whole transaction: no partial order, no leaked slot
capacity, no phantom reservation. See [09-ORDER-LIFECYCLE.md](09-ORDER-LIFECYCLE.md).

## 7. Background processing

A separate `apps/worker` Railway service (ADR-004) shares `packages/core` with the API.
Running it apart from the API means a long nightly batch never competes with checkout
latency, and it can be scaled or restarted independently.

| Job | Schedule (IST) | Purpose | Idempotency |
|---|---|---|---|
| `generate-subscription-deliveries` | 01:00 daily | Materialise `subscription_deliveries` for the next N days | Unique `(subscription_id, delivery_date)` |
| `materialise-subscription-orders` | Hourly | Turn deliveries due within the horizon into real orders | Unique `subscription_delivery_id` on orders |
| `send-delivery-reminders` | 20:00 daily | Remind customers about tomorrow's deliveries | Outbox dedupe key |
| `dispatch-outbox` | every 15s | Deliver pending domain events to channels | `status` + attempt counter, at-least-once |
| `expire-idempotency-keys` | 02:00 daily | Purge keys older than 24h | — |
| `roll-slot-capacity` | 00:30 daily | Ensure capacity rows exist for the booking horizon | Unique `(slot_id, service_date, zone_id)` |
| `auto-confirm-orders` | every 15 min | Auto-confirm PENDING orders whose slot cutoff has passed (BR-O3) | Status guard |
| `close-stale-orders` | 23:30 daily | Flag undelivered past-slot orders for ops review | Status guard |

MVP uses `node-cron` inside the worker with a Postgres advisory lock so a redeploy or a
second replica cannot double-run a job. If job volume or retry semantics outgrow this, the
migration path is BullMQ + Redis — the job interfaces are written to allow it (ADR-004).

## 8. Caching strategy

| Layer | What | TTL | Invalidation |
|---|---|---|---|
| Cloudflare edge | Marketing HTML, images, static assets | 1h HTML / 1y hashed assets | Purge by tag on publish |
| Next.js ISR (marketing) | Category and product pages | `revalidate: 300` | On-demand revalidate webhook from admin publish |
| API in-memory | Settings, zones, slots, active categories | 60s | Version counter bumped on write |
| HTTP `Cache-Control` on API reads | Public catalogue endpoints | `s-maxage=60, stale-while-revalidate=300` | ETag |
| Client (React Query) | Catalogue, cart, orders | Stale-while-revalidate | Mutation invalidation |

Authenticated endpoints are **never** edge-cached; they respond `Cache-Control: private, no-store`.

## 9. Multi-business / multi-location readiness

Requirement: expand later without a rewrite. Approach (ADR-005):

- Every operational table carries a nullable-free `business_id` from day one, defaulted to
  the single seeded business. Adding business two is data, not migration.
- `delivery_zones`, `delivery_slots`, `inventory` and `settings` are already scoped by
  business and zone.
- Products are global to a business; availability is expressed via
  `product_zone_availability` rather than duplicated catalogue rows.
- We do **not** implement tenant isolation (RLS, separate schemas) now — that is a Phase 3
  decision once the second location is real. The column is the cheap insurance; the policy
  is the expensive part and is deferred deliberately.

## 10. What we deliberately are not building

| Not building | Why | If we need it |
|---|---|---|
| Microservices | 1 team, 1 domain; network boundaries would cost more than they give | Bounded contexts already mark the seams |
| GraphQL | Mobile + web need a small, stable surface; REST + OpenAPI generates native clients better | Can be layered over `core` later |
| Event bus (Kafka/SQS) | Volume does not justify it | Outbox table is the seam; swap the dispatcher |
| Redis (MVP) | Postgres handles rate-limit counters and locks at our scale | Add for BullMQ and distributed rate limiting in P2 |
| Separate search engine | Postgres FTS covers a 200-SKU catalogue comfortably | Typesense/Meili in P2 behind `SearchPort` |
| Server-side session store | Firebase ID tokens are stateless and short-lived | Revocation list in Postgres if needed |
