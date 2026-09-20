# 03 — Technology Stack

Every entry states **what**, **why it beat the alternative**, and **what it costs us**.

## 1. Stack at a glance

| Concern | Choice | Version target |
|---|---|---|
| Language | TypeScript (strict) | 5.6+ |
| Runtime | Node.js LTS | 22.x |
| Package manager | pnpm | 9.x |
| Monorepo | Turborepo | 2.x |
| Frontend framework | Next.js App Router | 15.x |
| UI | React | 19.x |
| Styling | Tailwind CSS | 3.4.x (4.x deferred — ADR-027) |
| Component primitives | Radix UI + custom `packages/ui` | latest |
| Animation | Framer Motion | 11.x |
| Client data | TanStack Query | 5.x |
| Client forms | React Hook Form + Zod | latest |
| API framework | Hono + `@hono/zod-openapi` | 4.x |
| Validation | Zod | 3.x |
| ORM | Prisma | 5.x |
| Database | PostgreSQL | 16 |
| Auth | Firebase Authentication (+ Admin SDK) | v11 / v13 |
| Email | Brevo transactional API | v3 |
| Object storage | Cloudflare R2 + Cloudflare Images | — |
| Scheduling | node-cron in `apps/worker` + PG advisory locks | — |
| Logging | Pino (JSON) | 9.x |
| Errors | Sentry | latest |
| Testing | Vitest, Supertest, Playwright, Testcontainers | latest |
| Lint/format | ESLint 9 flat config + Prettier | latest |
| Hosting (web) | Vercel | — |
| Hosting (API, worker, DB) | Railway | — |
| Edge/DNS/WAF | Cloudflare | — |
| CI/CD | GitHub Actions + platform Git integrations | — |

## 2. Monorepo — decision and structure

### Should this be a monorepo?

Yes. Three frontends, one API and one worker all share types, validation schemas, design
system and domain logic. Polyrepo would force either published internal packages (version
skew, release friction for a small team) or copy-paste (guaranteed drift). The single
genuine downside — CI runs more than strictly necessary — is solved by Turborepo's
affected-graph and remote cache. **ADR-001.**

**Tooling:** pnpm workspaces for linking and a strict node_modules layout that catches
undeclared dependencies; Turborepo for task orchestration and caching. Nx was considered
and rejected as more machinery than we need; Bun workspaces rejected for ecosystem risk on
Prisma and Firebase Admin.

### Repository layout

```
healthly/
├── apps/
│   ├── marketing/          # maindomain.com       — Next.js, SSG/ISR, public
│   ├── customer/           # app.maindomain.com   — Next.js, authenticated
│   ├── admin/              # admin.maindomain.com — Next.js, RBAC console
│   ├── api/                # api.maindomain.com   — Hono HTTP service (Railway)
│   └── worker/             # cron + outbox dispatcher (Railway)
├── packages/
│   ├── core/               # domain + application services (framework-free)
│   ├── db/                 # Prisma schema, client, repositories, migrations, seed
│   ├── contracts/          # Zod schemas + inferred DTO types + error codes
│   ├── auth/               # Firebase verification, Actor model, permission checks
│   ├── ui/                 # design-system components (React + Tailwind)
│   ├── config/             # tsconfig / eslint / tailwind presets, env schema
│   ├── notifications/      # NotificationPort + Brevo/in-app adapters + templates
│   ├── payments/           # PaymentGateway port + COD adapter (+ future Razorpay)
│   ├── storage/            # StoragePort + R2 adapter, signed upload URLs
│   ├── observability/      # logger, metrics, Sentry wiring
│   └── sdk/                # generated typed API client used by all frontends
├── docs/                   # this directory — source of truth
├── database/
│   ├── migrations/         # generated Prisma SQL migrations (reviewed by hand)
│   └── seeds/              # environment-specific seed data
├── scripts/                # one-off and ops scripts
├── tests/
│   └── e2e/                # Playwright suites (cross-app journeys)
├── .github/workflows/
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

**Why `packages/contracts` and `packages/sdk` exist:** the Zod schemas in `contracts` are
the single definition of every request and response. The API validates with them; the
OpenAPI document is generated from them; `sdk` is a typed client generated from that
document. A breaking API change therefore fails the frontend type-check in CI rather than
in production. This same OpenAPI document is what generates the future Kotlin/Swift
clients — see [30-API-MOBILE-APP-READINESS.md](30-API-MOBILE-APP-READINESS.md).

**Why `apps/marketing` and `apps/customer` are separate apps** rather than one Next.js app
with route groups: different caching models (fully static vs fully dynamic), different
indexing policy (indexed vs `noindex`), different bundle budgets, different deploy cadence,
and different risk profiles. The cost is a shared-code discipline, which the monorepo
already gives us. **ADR-003.**

## 3. Frontend

### Next.js 15, App Router
Chosen for React Server Components (small client bundles on the catalogue path), built-in
image optimisation, file-based routing, streaming, and first-class Vercel deployment. The
marketing site leans on SSG/ISR for SEO and Core Web Vitals; the customer app uses RSC for
the initial catalogue render and client components for cart and checkout interactivity; the
admin app is mostly client-rendered because it is behind auth and needs no SEO.

**Rule:** frontends call `api.maindomain.com` through `packages/sdk`. Next.js server actions
and route handlers are used only for BFF-style concerns that must not reach the browser
(for example, exchanging a Firebase ID token for an admin session cookie). They never
contain business logic and never touch the database.

### Tailwind CSS 3.4
Utility-first, purged, no runtime cost, and design tokens expressed as CSS custom
properties so the same token set serves Tailwind, raw CSS and (later) React Native via a
shared token JSON. Rejected: CSS-in-JS (runtime cost, RSC friction), component libraries
with baked-in visual identity such as MUI/Chakra (we need an original brand, per the PRD).

### Radix UI primitives + our own `packages/ui`
Radix gives accessible, unstyled behaviour (dialog, popover, select, tabs, toast) — the
parts that are expensive to get right and invisible when done well. Everything visual is
ours. shadcn/ui-style copy-in components are used as a starting point, then owned.

### TanStack Query
Server-state cache with stale-while-revalidate, request dedupe, optimistic updates for cart
mutations, and retry policy. Redux/Zustand are not needed for server state; a small Zustand
store handles genuinely local UI state (cart drawer open, filter sheet).

## 4. Backend

### Hono
See [02-SYSTEM-ARCHITECTURE.md §3.1](02-SYSTEM-ARCHITECTURE.md) for the full comparison.
Short version: Web-standard, tiny, typed, and `@hono/zod-openapi` yields validation and
OpenAPI from one schema.

### Prisma
Chosen for migration ergonomics, generated types that flow into `core`, and excellent
Postgres support. Costs and mitigations:

- *Raw SQL when needed.* Reports and `SELECT ... FOR UPDATE` capacity locking use
  `$queryRaw` with parameterised SQL.
- *Enum/constraint gaps.* Prisma cannot express partial unique indexes or `CHECK`
  constraints. These are added via hand-written SQL inside generated migration files and are
  reviewed in PR. The schema doc marks every such constraint.
- *Migration discipline.* `prisma migrate dev` locally, `prisma migrate deploy` in CI, never
  `db push` outside a scratch database.

Drizzle was a close second (lighter, SQL-first, better raw-SQL story) but Prisma's migration
tooling and team familiarity win for a first build. Recorded in **ADR-008**.

### Zod
One validation library across the stack: API input validation, environment variable
validation at boot, form validation in the frontends, and OpenAPI generation.

## 5. Database — PostgreSQL 16 on Railway

Relational, transactional, with the specific features this domain needs:

- `SELECT ... FOR UPDATE` for slot-capacity and inventory races.
- Partial and composite unique indexes for idempotency (`subscription_deliveries`).
- `tsvector` + `pg_trgm` for MVP search without a second system.
- `jsonb` for genuinely open-ended fields (nutrition detail, event payloads, audit diffs).
- `numeric`/`bigint` for exact money (we use `bigint` paise — ADR-006).
- Point-in-time recovery on Railway for the RPO target.

**Extensions:** `pgcrypto` (UUID generation fallback), `pg_trgm` (fuzzy search), `citext`
(case-insensitive email/slug), `btree_gin` (composite catalogue filters).

## 6. Identity — Firebase Authentication

Two separate Firebase projects (ADR-010): `healthly-customer` and `healthly-admin`. A
customer token is cryptographically unable to authenticate against the admin panel because
the audience (`aud`) differs and each verifier accepts exactly one project. Full reasoning
in [07-AUTHENTICATION-AUTHORIZATION.md](07-AUTHENTICATION-AUTHORIZATION.md).

Firebase handles **authentication only**. Authorization, profile data and all business state
live in our PostgreSQL. We never store passwords, OTPs or Firebase refresh tokens.

## 7. Email — Brevo

Transactional email via Brevo's API, used **only** through `packages/notifications`:

```ts
interface NotificationChannel {
  readonly channel: 'EMAIL' | 'IN_APP' | 'WHATSAPP' | 'PUSH' | 'SMS';
  send(message: OutboundMessage): Promise<ChannelResult>;
}
```

No domain service imports the Brevo SDK. Swapping to Resend, SES or Postmark is one adapter.
Templates live in Brevo (so non-engineers can edit copy) and are referenced by a stable
template key mapped in code, with the payload contract documented per template in
[18-NOTIFICATION-ARCHITECTURE.md](18-NOTIFICATION-ARCHITECTURE.md).

## 8. Media — Cloudflare R2 + Cloudflare Images

Product photography is the core visual asset, so this must be fast and cheap.

- **R2** for originals: S3-compatible, zero egress fees, sits inside the Cloudflare account
  we already use for DNS/CDN.
- **Cloudflare Images / Image Resizing** for on-the-fly `width`, `format` (AVIF/WebP) and
  `quality` variants served from the edge.
- Uploads use **presigned URLs** issued by the API after a permission check; the browser
  uploads directly to R2 so images never transit our API. Content-type and size are
  constrained in the presign, and the object is validated (magic bytes, dimensions) by the
  worker before it is marked `READY`.

Rejected: local filesystem (Vercel/Railway containers are ephemeral), Vercel Blob (egress
pricing, weaker transform story), S3 (egress cost and an extra cloud account). **ADR-011.**

## 9. Observability

| Need | Tool |
|---|---|
| Structured logs | Pino JSON → Railway/Vercel log drains |
| Error tracking | Sentry (API, worker, all three frontends, source maps uploaded in CI) |
| Web vitals | Vercel Analytics (Core Web Vitals, p75 by route) |
| Uptime | Cloudflare health checks against `/v1/health` |
| DB metrics | Railway Postgres metrics + `pg_stat_statements` |
| Business audit | `audit_logs` table (not a log stream) |

Deliberately separated: **technical logs** (ephemeral, sampled, no PII) versus **business
audit** (durable, queryable, in Postgres). See [28-OBSERVABILITY.md](28-OBSERVABILITY.md).

## 10. Testing

| Level | Tool | Runs on |
|---|---|---|
| Unit (domain) | Vitest | every PR |
| Integration (API + real DB) | Vitest + Supertest + Testcontainers Postgres | every PR |
| Contract | OpenAPI diff check against `main` | every PR |
| E2E | Playwright against a preview deployment | every PR to `main`, nightly |
| Load | k6 on checkout and slot booking | before launch, before each peak |
| Security | `pnpm audit`, CodeQL, Gitleaks | every PR + weekly |

Full plan in [24-TESTING-STRATEGY.md](24-TESTING-STRATEGY.md).

## 11. Hosting split and why

| Component | Platform | Reason |
|---|---|---|
| marketing, customer, admin | **Vercel** | Best-in-class Next.js hosting, per-PR preview deployments, edge network, image optimisation, zero-config ISR |
| api, worker | **Railway** | Always-on containers, private networking to Postgres, no cold starts on checkout, real cron process |
| PostgreSQL | **Railway** | Same private network and region as the API; PITR backups |
| DNS, WAF, CDN, rate limit | **Cloudflare** | Sits in front of both platforms; one place for bot, TLS and edge caching policy |
| Auth | **Firebase** | Managed OTP delivery and token infrastructure |
| Email | **Brevo** | Required by the brief; good India deliverability and templating |
| Object storage | **Cloudflare R2** | Zero egress, integrated transforms |
| Source, CI | **GitHub** | Required by the brief; Actions for CI, native integrations for CD |

Region: all Railway services and the database in a single region closest to the launch city
(Asia-Southeast / Mumbai when available). Vercel functions pinned to the same region so any
SSR that must reach the API does not cross continents.

## 12. Version and upgrade policy

- Node and pnpm pinned via `engines` plus `.nvmrc`; CI uses the same versions.
- Dependencies updated by Renovate: patch/minor auto-merge on green CI, major by hand.
- Prisma, Next.js and Firebase Admin majors are upgraded on their own PR with a full E2E run.
- Every dependency added must be justified in the PR description; the review question is
  always "can `packages/core` do this in 30 lines instead?"
