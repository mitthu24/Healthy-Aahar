# 29 — Backup & Disaster Recovery

## 1. Objectives

| Metric | MVP target | Phase 2 target |
|---|---|---|
| **RPO** (maximum acceptable data loss) | ≤ 24 hours | ≤ 1 hour |
| **RTO** (maximum acceptable downtime) | ≤ 4 hours | ≤ 1 hour |

RPO is met by Railway's point-in-time recovery plus a daily independent snapshot; RTO is met
by the fact that the entire system is reproducible from Git plus a database restore.

**What "24 hours of data loss" would actually mean:** a day of orders, subscription
deliveries and payment records. It is survivable but painful — which is why PITR (recovery to
any second within the retention window) is enabled from day one rather than relying on the
daily snapshot alone. The 24-hour figure is the guaranteed worst case; the realistic case is
minutes.

## 2. What must be recoverable

| Asset | Where it lives | Backup | Criticality |
|---|---|---|---|
| PostgreSQL | Railway | PITR + daily snapshot + weekly off-platform dump | **Critical** |
| Source code | GitHub | Distributed clones + weekly archive | **Critical** |
| Product images | Cloudflare R2 | Versioning + weekly cross-account copy | High |
| Firebase users | Firebase | Weekly export to R2 | High |
| Secrets | Railway / Vercel / GitHub | Encrypted offline record held by the owner | **Critical** |
| Brevo templates | Brevo | Exported to the repo as JSON | Medium |
| Infrastructure config | Documented in `/docs` + platform | This directory | High |

**Secrets are the most commonly forgotten item.** Restoring a database is useless if nobody
can produce the Firebase service-account key. The owner keeps an encrypted record (password
manager with an emergency-access contact) of every credential, reviewed quarterly.

## 3. Database backups

| Layer | Frequency | Retention | Location |
|---|---|---|---|
| Railway PITR | Continuous WAL | 7 days | Railway |
| Railway snapshot | Daily | 7 days | Railway |
| `pg_dump` to R2 | Daily 03:00 IST | 30 days | Cloudflare R2 |
| `pg_dump` to R2 | Weekly (Sunday) | 12 weeks | R2, separate bucket |

The independent `pg_dump` matters because layers 1 and 2 share a single failure domain: an
account compromise, a billing lapse or a platform incident could take all of Railway with it.
A copy under our own Cloudflare account is what makes the backup strategy real rather than
nominal.

Dumps are compressed, encrypted at rest, and named `healthly-prod-YYYYMMDD-HHMM.dump`.
The dump job writes a `job_runs` row and alerts on failure (doc 28 §8).

**Restore testing:** monthly, on the first Monday, the latest dump is restored into a scratch
Railway database and verified — row counts on key tables, the latest order present, migration
state consistent. The result is recorded. **An untested backup is a hypothesis, not a
backup**, and the first real restore is the wrong time to discover a broken dump.

## 4. Restore procedures

### 4.1 Point-in-time restore (accidental deletion, bad migration)
```
1. Identify the exact timestamp before the damage (audit_logs and deploy history give it)
2. Railway → Database → Restore → PITR to that timestamp (creates a NEW instance)
3. Verify the new instance: row counts, latest order, migration state
4. Put the API into maintenance mode (Cloudflare page rule)
5. Repoint DATABASE_URL to the restored instance; redeploy api and worker
6. Smoke test: read an order, place a test order, run one job
7. Lift maintenance mode
8. Post-incident review
```
Estimated 30–60 minutes. Restoring to a **new** instance rather than in place preserves the
damaged database for forensics and allows an abort.

### 4.2 Full platform loss (Railway unavailable)
```
1. Provision Postgres elsewhere (Neon, Supabase, RDS)
2. Restore the latest R2 dump
3. Deploy api and worker to an alternative host (Render, Fly, Cloud Run) from the same repo
4. Update the Cloudflare CNAME for api.maindomain.com
5. Verify and monitor
```
Estimated 2–4 hours. This is feasible because the API is an ordinary Docker container with no
Railway-specific dependency beyond environment variables — a deliberate constraint on the
architecture, not an accident.

### 4.3 Frontend loss (Vercel unavailable)
Build locally or in CI and deploy to Cloudflare Pages or Netlify; update DNS. Estimated 1–2
hours. Marketing content is static, so a cached Cloudflare copy continues serving during the
switch.

## 5. Migration rollback

Doc 25 §8–9 sets the rules; the recovery paths are:

| Situation | Action |
|---|---|
| Additive migration, bad code | Roll back the code only. The migration is harmless. |
| Migration breaks the running app | Deploy a forward fix immediately. |
| Destructive migration, data lost | PITR to just before it. **Last resort** — loses everything since. |

The reason migrations must be backward-compatible (doc 25 §8 rule 2) is precisely to keep the
first row the normal case and the third row a never-used emergency path.

## 6. Failure scenarios

| Scenario | Impact | Response | Target |
|---|---|---|---|
| Database down | Total outage | Railway status; failover or restore | < 1h |
| API down | Total outage (marketing serves cached) | Redeploy previous image; check Sentry | < 15m |
| Worker down | Deliveries not generated or materialised | Restart; run jobs manually via `/v1/internal/jobs/*` — they are idempotent | < 1h |
| Vercel down | Frontends down; API unaffected | Deploy elsewhere or wait | < 2h |
| Cloudflare down | Everything unreachable | Temporarily bypass proxy via DNS | < 1h |
| Firebase down | No new sign-ins; existing tokens keep working for up to 1h | Wait; status page | — |
| Brevo down | Emails delayed, not lost — outbox retries | Wait; monitor outbox depth | — |
| R2 down | Images broken; ordering still works | Wait; placeholder images | — |
| Bad deploy | Errors | Instant rollback (doc 25 §9) | < 5m |
| Data corruption from a bug | Incorrect business state | Stop the write path, assess, targeted repair with an audit trail, or PITR | < 4h |
| Ransomware / account compromise | Potential total loss | Off-platform R2 backups; rotate every credential; restore | < 8h |

The outbox design is what makes the Brevo row benign: a provider outage delays notifications
and never loses them (doc 18 §2).

## 7. Incident response

### Severity
| Level | Definition | Response |
|---|---|---|
| **SEV1** | Customers cannot order, or data loss is occurring | Immediate, all hands |
| **SEV2** | Major feature broken (subscriptions not generating) | Within 1 hour |
| **SEV3** | Degraded (slow, one report broken) | Same business day |
| **SEV4** | Cosmetic | Next sprint |

### Process
```
1. DETECT     alert, monitor, or customer report
2. ASSESS     severity, blast radius, is data at risk?
3. COMMUNICATE  status page / social if customer-visible; tell support what to say
4. MITIGATE   stop the bleeding first — roll back, disable a feature flag, maintenance mode.
              Fixing properly comes after the bleeding stops.
5. RESOLVE    deploy the fix, verify
6. VERIFY     confirm with real data and monitoring
7. REVIEW     blameless post-incident note within 48h
```

### Post-incident note (required for SEV1 and SEV2)
Timeline, customer impact (how many, for how long), root cause, why it was not caught,
what was done, and concrete prevention items with owners. Blameless: the question is what in
the *system* allowed a person to cause this, not who caused it. Stored in
`docs/incidents/YYYY-MM-DD-short-name.md`.

## 8. Business continuity while degraded

The operations team must be able to keep delivering even if the platform is down, because
food is perishable and customers are waiting.

- The **dispatch manifest** and **prep list** are printable; a printed copy of tomorrow's
  manifest is taken at the end of each day. If the system is down at 05:00, the kitchen still
  knows what to make and where it goes.
- COD collection is reconciled manually and entered when the system returns.
- A prepared customer-communication template exists for delays and outages.

This is the cheapest disaster-recovery control in the entire document and the one most likely
to actually be used.

## 9. Retention and deletion

Backups follow the same retention as the data they contain (doc 04 §15). A customer erasure
request is applied to the live database immediately; backups age out naturally within 90
days, and this is stated in the privacy policy rather than pretended otherwise.

## 10. Schedule

| Task | Frequency | Owner |
|---|---|---|
| Automated dump to R2 | Daily | System |
| Verify dump succeeded | Daily | Alert |
| **Test restore** | Monthly | Engineering |
| Firebase user export | Weekly | System |
| R2 cross-account copy | Weekly | System |
| Secret record review | Quarterly | Owner |
| Full DR drill (simulated platform loss) | Twice yearly | Engineering |
| Review this document | Quarterly | Engineering |
