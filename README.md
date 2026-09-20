# Healthy Aahar

Fresh fruit, salads, sprouts and healthy meals — prepared the morning we deliver them,
brought to the customer in a delivery slot they choose.

| Surface   | Domain                   | App              |
| --------- | ------------------------ | ---------------- |
| Marketing | `healthyaahar.com`       | `apps/marketing` |
| Customer  | `app.healthyaahar.com`   | `apps/customer`  |
| Admin     | `admin.healthyaahar.com` | `apps/admin`     |
| API       | `api.healthyaahar.com`   | `apps/api`       |
| Worker    | — (no public ingress)    | `apps/worker`    |

**Current phase:** PHASE 01 — Repository & Infrastructure Foundation.
See [docs/PHASE-01-IMPLEMENTATION-REPORT.md](docs/PHASE-01-IMPLEMENTATION-REPORT.md).

---

## Getting started

Prerequisites: **Node 22+**, **pnpm 9+**, **Docker**.

```bash
git clone <repo-url> healthy-aahar
cd healthy-aahar

pnpm install
cp .env.example .env
cp apps/marketing/.env.example apps/marketing/.env.local
cp apps/customer/.env.example  apps/customer/.env.local
cp apps/admin/.env.example     apps/admin/.env.local

pnpm infra:up        # PostgreSQL, MinIO, Firebase Auth emulator
pnpm db:generate
pnpm db:migrate
pnpm db:seed

pnpm dev             # everything, in parallel
```

| Port        | Service                                |
| ----------- | -------------------------------------- |
| 3000        | Marketing                              |
| 3001        | Customer app                           |
| 3002        | Admin panel                            |
| 4000        | API                                    |
| 5432        | PostgreSQL                             |
| 5434        | PostgreSQL (migration shadow database) |
| 9000 / 9001 | MinIO API / console                    |
| 9099 / 4001 | Firebase Auth emulator / UI            |

Verify the stack is alive:

```bash
curl http://localhost:4000/v1/health/ready
curl "http://localhost:4000/v1/public/serviceability?pincode=201301"
```

## Commands

| Command                                        | Does                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------ |
| `pnpm dev`                                     | Run every app and service                                          |
| `pnpm build`                                   | Build everything                                                   |
| `pnpm verify`                                  | format + lint + typecheck + test + build — run this before pushing |
| `pnpm test`                                    | All test suites                                                    |
| `pnpm lint` / `pnpm typecheck`                 | Static checks                                                      |
| `pnpm db:migrate`                              | Create and apply a migration (development)                         |
| `pnpm db:migrate:deploy`                       | Apply pending migrations (CI, production)                          |
| `pnpm db:seed`                                 | Load bootstrap data (idempotent)                                   |
| `pnpm db:studio`                               | Browse the database                                                |
| `pnpm infra:up` / `infra:down` / `infra:reset` | Local containers                                                   |

## Repository layout

```
apps/
  marketing/      Public site, SSG/ISR, indexable
  customer/       Authenticated customer app, noindex
  admin/          Operations console, noindex, RBAC
  api/            Hono HTTP service — the ONLY writer to the database
  worker/         Scheduled jobs and the outbox dispatcher
packages/
  core/           Domain logic — pure, framework-free, no I/O
  db/             Prisma schema, migrations, seed, client
  contracts/      Zod schemas — one definition for API, clients and OpenAPI
  auth/           Firebase verification (two projects — ADR-010)
  ui/             Design system components
  config/         tsconfig / eslint / tailwind presets, design tokens, env schemas
  notifications/  NotificationChannel port (+ Noop, Capturing)
  payments/       PaymentGateway port (+ Cash on Delivery adapter)
  storage/        StoragePort — presigned uploads
  observability/  Structured logging with PII redaction
  sdk/            Typed API client used by all three frontends
docs/             38 architecture documents — the source of truth
scripts/          Operational scripts
tests/e2e/        Playwright suites (from PHASE 07)
```

## Architecture in one paragraph

Every capability is an HTTP endpoint before it is a screen. Only `apps/api` and
`apps/worker` talk to PostgreSQL; the frontends call the API through `packages/sdk`, which
is exactly how the future Android and iOS apps will call it. Domain logic lives in
`packages/core` as plain TypeScript with no framework and no I/O, so the same rules are
executed by the API, by background jobs and by fast unit tests. Correctness invariants that
would damage the business are enforced by **database constraints**, not only by application
code. Full reasoning: [docs/02-SYSTEM-ARCHITECTURE.md](docs/02-SYSTEM-ARCHITECTURE.md).

## Serviceability is admin-controlled

Where Healthy Aahar delivers is **data, not code**. There is no city list, no pincode list
and no `if (city === 'Noida')` anywhere in the codebase — CI greps for exactly that.

```
cities  (ACTIVE | INACTIVE | COMING_SOON)
   └── service_pincodes  (ACTIVE | INACTIVE | COMING_SOON)
          └── delivery zones + slots   [PHASE 06 — may narrow, never widen]
```

Expanding from Noida to Greater Noida, Delhi, Ghaziabad or Gurgaon is a row change made by
an admin, with no deploy. Switching a city off stops **new** serviceability and never
deletes a customer, address, order or subscription.

See [docs/04-DATABASE-DESIGN.md §6](docs/04-DATABASE-DESIGN.md) and rules `BR-SV1`–`BR-SV12`
in [docs/31-BUSINESS-RULES.md](docs/31-BUSINESS-RULES.md).

## Conventions that are not negotiable

- **Money is integer paise.** Never a float. `formatPaise()` is the only formatter.
- **Instants are UTC; business days are `Asia/Kolkata`.** All conversion lives in
  `packages/core/src/domain/time.ts`. Bare `new Date()` is a lint error — use `now()`.
- **Every admin route declares a permission.** The route registry asserts this at boot, so
  an unguarded endpoint fails the deploy instead of shipping.
- **No secret carries a `NEXT_PUBLIC_` prefix.** CI enforces it.
- **Non-production never contacts a real customer.** The env schema refuses to start
  otherwise.
- **`/docs` is updated in the same PR as the code it describes.**

## Documentation

Start with [docs/README.md](docs/README.md). The documents that most often answer a
question:

| Question                        | Document                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------- |
| What are we building?           | [01-PRODUCT-REQUIREMENTS-DOCUMENT](docs/01-PRODUCT-REQUIREMENTS-DOCUMENT.md)          |
| How is it put together?         | [02-SYSTEM-ARCHITECTURE](docs/02-SYSTEM-ARCHITECTURE.md)                              |
| What does the schema look like? | [04-DATABASE-DESIGN](docs/04-DATABASE-DESIGN.md)                                      |
| What are the endpoints?         | [06-API-SPECIFICATION](docs/06-API-SPECIFICATION.md)                                  |
| Why was X decided that way?     | [36-DECISIONS-LOG](docs/36-DECISIONS-LOG.md)                                          |
| What rule governs Y?            | [31-BUSINESS-RULES](docs/31-BUSINESS-RULES.md)                                        |
| What is in scope right now?     | [33-MVP-SCOPE](docs/33-MVP-SCOPE.md) · [34-PHASED-ROADMAP](docs/34-PHASED-ROADMAP.md) |

## Contributing

Trunk-based: short-lived branches off `main`, squash merge, Conventional Commits.
Run `pnpm verify` before pushing. See [docs/26-GITHUB-WORKFLOW.md](docs/26-GITHUB-WORKFLOW.md).
