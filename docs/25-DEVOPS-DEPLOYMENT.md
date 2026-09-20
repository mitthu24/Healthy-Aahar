# 25 — DevOps & Deployment

## 1. Topology

```
                     ┌─────────────────────────────┐
                     │        Cloudflare           │
                     │  DNS (authoritative) · WAF  │
                     │  CDN · TLS · Rate limiting  │
                     └──────────────┬──────────────┘
        ┌──────────────┬────────────┼─────────────┬──────────────┐
        │              │            │             │              │
  maindomain.com   app.…      admin.…        api.…          cdn.…
        │              │            │             │              │
   ┌────▼──────────────▼────────────▼────┐   ┌────▼──────┐  ┌────▼────┐
   │            VERCEL                   │   │  RAILWAY  │  │   R2    │
   │  marketing · customer · admin       │   │  api      │  │ images  │
   │  (3 projects, one repo)             │   │  worker   │  └─────────┘
   └─────────────────────────────────────┘   │  postgres │
                                              └───────────┘
   GitHub (source, CI)  ·  Firebase (auth ×2)  ·  Brevo (email)
```

## 2. Why this split

| Component | Platform | Reason |
|---|---|---|
| 3 frontends | Vercel | Native Next.js hosting, per-PR previews, edge network, image optimisation, zero-config ISR |
| API + worker | Railway | Always-on containers, private networking to Postgres, no cold start on checkout, a real process for cron |
| PostgreSQL | Railway | Same region and private network as the API; PITR backups |
| Edge | Cloudflare | One place for DNS, WAF, TLS and caching in front of **both** platforms |

Running the API on Railway rather than Vercel is the load-bearing decision here (ADR-002):
it gives a persistent connection pool, a home for the scheduler, and a database that is not
reachable from the public internet.

## 3. DNS

Cloudflare is authoritative for `maindomain.com`.

| Record | Type | Target | Proxy |
|---|---|---|---|
| `@` | CNAME (flattened) | `cname.vercel-dns.com` | ☁️ On |
| `www` | CNAME | `cname.vercel-dns.com` | ☁️ On |
| `app` | CNAME | `cname.vercel-dns.com` | ☁️ On |
| `admin` | CNAME | `cname.vercel-dns.com` | ☁️ On |
| `api` | CNAME | `<service>.up.railway.app` | ☁️ On |
| `cdn` | CNAME | R2 custom domain | ☁️ On |
| `mail` | MX / TXT | Brevo (SPF, DKIM, DMARC) | ⬜ DNS only |
| `_dmarc` | TXT | `v=DMARC1; p=quarantine; rua=…` | ⬜ DNS only |

Everything user-facing is proxied so WAF, caching and rate limiting apply. Mail records are
never proxied.

**Is `api.maindomain.com` necessary?** Yes (doc 02 §3). A dedicated origin gives mobile apps
a stable base URL independent of any web deployment, keeps CORS explicit, and avoids the
serverless connection-pool problem on the checkout path.

## 4. Cloudflare configuration

TLS Full (strict), TLS 1.3 minimum, HSTS with preload, Always Use HTTPS, Brotli, HTTP/3.

| Rule | Scope | Action |
|---|---|---|
| Cache `/_next/static/*` | All web apps | Edge cache 1 year |
| Bypass cache `api.maindomain.com/*` | API | No cache (the API sets its own headers) |
| Cache marketing HTML | `maindomain.com/*` | Standard, respect origin |
| Rate limit `/v1/auth/*` | API | 30/min per IP |
| Rate limit all | API | 600/min per IP |
| WAF managed rules | All | OWASP core ruleset |
| Cloudflare Access | `admin.maindomain.com` | Email OTP or IP allow-list (launch recommendation) |
| Bot Fight Mode | Marketing | On |

## 5. Vercel

Three projects from one repository, each with its own root directory and build command
(Turborepo handles the dependency graph and remote caching).

| Project | Root | Domain | Region |
|---|---|---|---|
| `healthly-marketing` | `apps/marketing` | `maindomain.com`, `www` | Mumbai (`bom1`) |
| `healthly-customer` | `apps/customer` | `app.maindomain.com` | Mumbai |
| `healthly-admin` | `apps/admin` | `admin.maindomain.com` | Mumbai |

- `main` → production; every PR → a preview deployment with a unique URL.
- Preview deployments point at the **staging** API, never production.
- Preview deployments carry Vercel's deployment protection so they are not publicly crawlable.
- `ignoreCommand` uses `turbo-ignore` so a docs-only change does not rebuild three apps.

## 6. Railway

| Service | Type | Notes |
|---|---|---|
| `api` | Docker (Node 22) | Public via `api.maindomain.com`; health check `/v1/health/ready` |
| `worker` | Docker (Node 22) | **No public networking**; cron and outbox dispatcher |
| `postgres` | Managed Postgres 16 | Private network only; PITR enabled |

Two environments: `production` and `staging`, each with its own database.
The API and worker share a repository and an image but run different entry points, so they
cannot drift in dependency versions.

**Health checks:** `/v1/health` (liveness) and `/v1/health/ready` (checks the database).
Railway waits for readiness before shifting traffic, which gives zero-downtime deploys.

**Private networking:** `DATABASE_URL` uses Railway's internal hostname. The database has no
public endpoint. This is the single most effective database-security control available, and
it costs nothing.

## 7. Deployment flow

```
PR opened
  └─ GitHub Actions: lint, typecheck, unit, integration, build, migration check,
                     OpenAPI diff, bundle size, security scans
  └─ Vercel: 3 preview deployments
  └─ Railway: staging API redeployed from the PR branch (optional, on label)
  └─ Playwright E2E against the preview
  └─ Lighthouse CI

PR merged to main
  └─ CI re-runs on main
  └─ Railway: build api + worker → run `prisma migrate deploy` → health check → swap
  └─ Vercel: build and deploy 3 apps
  └─ Smoke tests against production
  └─ Sentry release created, source maps uploaded
```

**Order matters:** migrations and the API deploy **before** the frontends. A frontend that
expects a new field must never reach users before the API can return it.

## 8. Migrations

```
Local      prisma migrate dev          creates and applies a migration
PR         CI applies it to a fresh DB and to a production-shaped snapshot
Deploy     prisma migrate deploy       runs as a Railway pre-deploy command
```

**Rules**
1. Migrations are forward-only. A mistake is corrected by a new migration.
2. Every migration must be **backward-compatible with the currently running code**, because
   the old version is still serving traffic while the new one starts.
3. Destructive changes use the **expand/contract** pattern across two deploys:
   - *Expand:* add the new column, backfill, write to both.
   - *Switch:* read from the new column.
   - *Contract:* drop the old column in a later release.
4. Backfills for large tables run as a separate, batched, resumable script — never inside the
   migration, which would hold a lock during deploy.
5. `prisma db push` is never used outside a scratch database.
6. A production migration is always preceded by a manual backup snapshot.

## 9. Rollback

| Failure | Action | Time |
|---|---|---|
| Frontend bug | Vercel instant rollback to the previous deployment | < 1 min |
| API bug (no migration) | Railway redeploy of the previous image | < 5 min |
| API bug (with migration) | Deploy a forward fix; roll back code only if the migration was additive | 5–30 min |
| Bad migration | Restore from PITR to just before it — **last resort**, data loss between then and now | 30–60 min |
| Config error | Correct the environment variable and redeploy | < 5 min |

This is precisely why rule 8.2 exists: if every migration is backward-compatible, a code
rollback is always safe and the expensive path is never needed.

## 10. Environments

| Environment | Frontends | API | Database | Firebase | Brevo |
|---|---|---|---|---|---|
| Local | `localhost:3000/3001/3002` | `localhost:4000` | Docker Postgres | Emulator | Noop channel |
| Preview (per PR) | Vercel preview URLs | Staging API | Staging DB | Staging projects | Noop channel |
| Staging | `staging.*` (optional) | Railway staging | Staging DB | Staging projects | Noop channel |
| Production | Real domains | Railway production | Production DB | Production projects | Live |

**Non-production never sends a real email, SMS or WhatsApp message** (BR-N9). The channel
registry selects `NoopChannel` whenever `APP_ENV !== 'production'`, and this is asserted by a
test rather than trusted to configuration.

## 11. Secrets

Railway environment variables for API and worker; Vercel environment variables (scoped to
production/preview/development) for frontends; GitHub Actions encrypted secrets for CI.
No secret in the repository. Gitleaks runs in CI and as a pre-commit hook. Rotation is
quarterly and immediate on suspected exposure. Full variable list in doc 27.

## 12. Observability wiring

Sentry on all five deployables with release tracking and source maps uploaded at build time.
Pino JSON logs to Railway/Vercel log drains. Vercel Analytics for Core Web Vitals.
Cloudflare health checks against `/v1/health`. Railway metrics for CPU, memory and database.
Details in doc 28.

## 13. Cost profile (order of magnitude, launch scale)

| Service | Monthly |
|---|---|
| Vercel Pro | ~$20 |
| Railway (api + worker + Postgres) | ~$25–45 |
| Cloudflare | Free tier, or $20 Pro for enhanced WAF |
| Firebase Auth | Free under 50k MAU; SMS billed per OTP |
| Brevo | Free tier to 300/day; ~$25 beyond |
| R2 | ~$1–5 (zero egress) |
| Sentry | Free tier initially |

Roughly **$70–120/month** at launch. The dominant variable cost is OTP SMS, which scales with
sign-ups rather than with traffic.

## 14. Launch checklist

- [ ] Domain purchased, Cloudflare nameservers propagated
- [ ] All subdomains resolving with valid TLS, HSTS preload submitted
- [ ] Production Firebase projects created (customer and admin), App Check configured
- [ ] Brevo sender domain verified; SPF, DKIM and DMARC passing
- [ ] Railway production database created, PITR verified by a test restore
- [ ] Migrations applied; seed data loaded (business, zone, pincodes, slots, roles, super admin)
- [ ] All environment variables set in all three platforms
- [ ] Cloudflare WAF, rate limits and page rules configured
- [ ] Cloudflare Access on `admin.`
- [ ] Sentry projects with alert rules
- [ ] Uptime checks configured
- [ ] Smoke test: place a real order end to end, confirm the email arrives
- [ ] Rollback rehearsed at least once
- [ ] Backup restore rehearsed at least once
- [ ] Security header scan passing
- [ ] Lighthouse ≥ 95 on marketing
- [ ] `robots.txt` and `noindex` verified on app and admin
- [ ] Legal pages published
