# 27 — Environment Configuration

## 1. Environments

| Environment | `APP_ENV` | Purpose | Data | External sends |
|---|---|---|---|---|
| Local | `local` | Development on a laptop | Docker Postgres, seeded | None (Noop) |
| Preview | `preview` | Per-PR Vercel deployment | Staging DB | None (Noop) |
| Staging | `staging` | Pre-production verification | Staging DB, prod-shaped | None (Noop) |
| Production | `production` | Live | Production DB | Live |

`NODE_ENV` is used only by tooling (`development` / `production` / `test`). All application
behaviour branches on `APP_ENV`, because a Vercel preview is `NODE_ENV=production` but must
absolutely not send real emails. Conflating the two is the most common cause of a staging
system emailing real customers.

## 2. Validation at boot

Every service validates its environment with a Zod schema in `packages/config` **before
anything else starts**. A missing or malformed variable crashes the process at startup with
a readable message naming the variable.

```ts
// packages/config/src/env.server.ts — shape
const schema = z.object({
  APP_ENV: z.enum(['local','preview','staging','production']),
  DATABASE_URL: z.string().url(),
  FIREBASE_CUSTOMER_PROJECT_ID: z.string().min(1),
  FIREBASE_ADMIN_SERVICE_ACCOUNT_B64: z.string().min(1),
  BREVO_API_KEY: z.string().startsWith('xkeysib-').optional(),
  // …
}).superRefine((env, ctx) => {
  if (env.APP_ENV === 'production' && !env.BREVO_API_KEY) {
    ctx.addIssue({ code: 'custom', message: 'BREVO_API_KEY is required in production' });
  }
});
```

Fail fast at boot, never at 2 a.m. on the first request that happens to need the variable.

**Client/server separation:** `env.client.ts` accepts only `NEXT_PUBLIC_*` variables;
`env.server.ts` is imported with `import 'server-only'`. A CI check fails the build if a
secret-looking value carries a `NEXT_PUBLIC_` prefix — everything with that prefix ships to
the browser and must be treated as public by definition.

## 3. `.env.example` — API and worker

```bash
# ── Application ───────────────────────────────────────────────
APP_ENV=local                       # local | preview | staging | production
NODE_ENV=development
PORT=4000
LOG_LEVEL=debug                     # debug | info | warn | error
APP_VERSION=                        # injected by CI from the git SHA

# ── Database ──────────────────────────────────────────────────
DATABASE_URL=postgresql://healthly:healthly@localhost:5432/healthly?schema=public
DATABASE_POOL_SIZE=10
DATABASE_STATEMENT_TIMEOUT_MS=10000

# ── CORS ──────────────────────────────────────────────────────
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:3001,http://localhost:3002

# ── Firebase: CUSTOMER project (server-side verification) ─────
FIREBASE_CUSTOMER_PROJECT_ID=healthly-customer-local
FIREBASE_CUSTOMER_SERVICE_ACCOUNT_B64=          # base64 of the service-account JSON

# ── Firebase: ADMIN project (server-side verification) ────────
FIREBASE_ADMIN_PROJECT_ID=healthly-admin-local
FIREBASE_ADMIN_SERVICE_ACCOUNT_B64=
FIREBASE_AUTH_EMULATOR_HOST=localhost:9099      # local only; unset elsewhere

# ── Sessions ──────────────────────────────────────────────────
ADMIN_SESSION_MAX_AGE_SECONDS=43200             # 12h
ADMIN_SESSION_IDLE_TIMEOUT_SECONDS=1800         # 30m
ADMIN_COOKIE_DOMAIN=                            # empty for __Host- prefix

# ── Email (Brevo) ─────────────────────────────────────────────
BREVO_API_KEY=                                  # required in production
BREVO_SENDER_EMAIL=orders@mail.maindomain.com
BREVO_SENDER_NAME=Healthly
BREVO_WEBHOOK_SECRET=
NOTIFICATIONS_ENABLED=false                     # false => NoopChannel

# ── Object storage (Cloudflare R2) ────────────────────────────
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=healthly-media-local
R2_PUBLIC_BASE_URL=http://localhost:9000/healthly-media-local
R2_UPLOAD_MAX_BYTES=5242880
R2_PRESIGN_TTL_SECONDS=300

# ── Internal service auth (worker → API) ──────────────────────
INTERNAL_SERVICE_TOKEN=change-me-in-every-environment

# ── Business defaults (overridable in the settings table) ─────
DEFAULT_TIMEZONE=Asia/Kolkata
DEFAULT_CURRENCY=INR
BOOKING_HORIZON_DAYS=7
SUBSCRIPTION_GENERATION_HORIZON_DAYS=14
SUBSCRIPTION_MATERIALISE_HORIZON_HOURS=36

# ── Rate limiting ─────────────────────────────────────────────
RATE_LIMIT_ENABLED=true
RATE_LIMIT_READ_PER_MIN=300
RATE_LIMIT_WRITE_PER_MIN=60
RATE_LIMIT_ORDER_PER_MIN=10

# ── Observability ─────────────────────────────────────────────
SENTRY_DSN=
SENTRY_ENVIRONMENT=local
SENTRY_TRACES_SAMPLE_RATE=0.1

# ── Worker ────────────────────────────────────────────────────
WORKER_ENABLED=true
CRON_GENERATE_DELIVERIES=0 1 * * *
CRON_MATERIALISE_ORDERS=0 * * * *
CRON_ROLL_SLOT_CAPACITY=30 0 * * *
CRON_SEND_REMINDERS=0 20 * * *
OUTBOX_DISPATCH_INTERVAL_MS=15000
OUTBOX_MAX_ATTEMPTS=5

# ── Feature flags ─────────────────────────────────────────────
FEATURE_COUPONS=false
FEATURE_REVIEWS=false
FEATURE_ONLINE_PAYMENT=false
FEATURE_WHATSAPP=false
```

## 4. `.env.example` — frontends

```bash
# ── Common to all three apps ──────────────────────────────────
NEXT_PUBLIC_APP_ENV=local
NEXT_PUBLIC_API_BASE_URL=http://localhost:4000
NEXT_PUBLIC_MARKETING_URL=http://localhost:3000
NEXT_PUBLIC_APP_URL=http://localhost:3001
NEXT_PUBLIC_CDN_BASE_URL=http://localhost:9000/healthly-media-local
NEXT_PUBLIC_SENTRY_DSN=
SENTRY_AUTH_TOKEN=                       # server-only, for source-map upload

# ── apps/customer — Firebase CUSTOMER web config ──────────────
# These are public by design: Firebase web config is not a secret.
# Security comes from Firebase rules, App Check and our API.
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=healthly-customer-local.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=healthly-customer-local
NEXT_PUBLIC_FIREBASE_APP_ID=
NEXT_PUBLIC_RECAPTCHA_SITE_KEY=          # App Check
NEXT_PUBLIC_USE_AUTH_EMULATOR=true       # local only

# ── apps/admin — Firebase ADMIN web config (separate project) ─
NEXT_PUBLIC_FIREBASE_ADMIN_API_KEY=
NEXT_PUBLIC_FIREBASE_ADMIN_AUTH_DOMAIN=healthly-admin-local.firebaseapp.com
NEXT_PUBLIC_FIREBASE_ADMIN_PROJECT_ID=healthly-admin-local
NEXT_PUBLIC_FIREBASE_ADMIN_APP_ID=

# ── apps/marketing ────────────────────────────────────────────
REVALIDATE_SECRET=                       # server-only; on-demand ISR webhook
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

## 5. Environment variable matrix

| Variable | Local | Preview | Staging | Production |
|---|---|---|---|---|
| `DATABASE_URL` | Docker | Staging DB | Staging DB | Production DB (private network) |
| Firebase projects | Emulator | `*-staging` | `*-staging` | `*-prod` |
| `NOTIFICATIONS_ENABLED` | `false` | `false` | `false` | **`true`** |
| `BREVO_API_KEY` | unset | unset | unset | set |
| `LOG_LEVEL` | `debug` | `info` | `info` | `info` |
| `SENTRY_TRACES_SAMPLE_RATE` | `0` | `0.1` | `0.1` | `0.1` |
| `RATE_LIMIT_ENABLED` | `false` | `true` | `true` | `true` |
| `ALLOWED_ORIGINS` | localhost | `*.vercel.app` + staging | staging domains | production domains only |
| `INTERNAL_SERVICE_TOKEN` | dev value | unique | unique | unique, rotated |

## 6. Configuration versus settings

Two different things, deliberately separated:

| | Environment variables | `settings` table |
|---|---|---|
| Changed by | Engineers, via a deploy | Admins, in the UI |
| Examples | `DATABASE_URL`, API keys, feature flags | Booking horizon, pause limits, support hours, default fees |
| Applies | At boot | Within 60s (cached) |
| Audited | Platform audit log | `audit_logs` |

**Rule:** anything the business might reasonably want to change without an engineer belongs
in `settings`. Anything that is a secret or a deployment detail belongs in the environment.
Environment variables provide the *defaults* that seed `settings` on first run; after that,
`settings` wins.

## 7. Local development

```bash
git clone … && cd healthly
pnpm install
cp .env.example .env.local            # repeat per app
docker compose up -d                  # postgres + minio (R2-compatible) + firebase emulator
pnpm db:migrate
pnpm db:seed                          # business, zone, slots, roles, super admin, sample catalogue
pnpm dev                              # turbo runs all apps + api + worker
```

| Port | Service |
|---|---|
| 3000 | marketing |
| 3001 | customer |
| 3002 | admin |
| 4000 | api |
| 5432 | postgres |
| 9000 | minio (R2-compatible object storage) |
| 9099 | firebase auth emulator |

MinIO stands in for R2 so the upload path — presign, direct upload, worker validation — is
exercised locally rather than stubbed. The Firebase emulator means OTP flows are testable
without sending SMS or paying for it.

## 8. Rules

| ID | Rule |
|---|---|
| BR-ENV1 | Every service validates its environment at boot and refuses to start if invalid. |
| BR-ENV2 | Behaviour branches on `APP_ENV`, never on `NODE_ENV`. |
| BR-ENV3 | Non-production never sends real email, SMS or WhatsApp. |
| BR-ENV4 | No production credential exists in any non-production environment. |
| BR-ENV5 | `NEXT_PUBLIC_*` is public by definition; a server secret with that prefix fails CI. |
| BR-ENV6 | `.env*` files are git-ignored; only `.env.example` is committed, with placeholders. |
| BR-ENV7 | Adding a variable means updating `.env.example`, the Zod schema, this document, and every platform's configuration in the same PR. |
| BR-ENV8 | Production database credentials exist only on Railway services. |
| BR-ENV9 | `INTERNAL_SERVICE_TOKEN` differs per environment and is compared in constant time. |
