# 28 — Observability

## 1. Two kinds of record, kept apart

| | Technical logs | Business audit |
|---|---|---|
| Question answered | "Why did the system behave that way?" | "Who changed this, and when?" |
| Store | Log drain (Railway/Vercel), Sentry | `audit_logs` in PostgreSQL |
| Audience | Engineers | Owner, support, compliance |
| Retention | 7–30 days | 24 months |
| Contains PII | **Never** | Deliberately (redacted where possible) |
| Queryable by | Log search | SQL, admin UI |
| Sampled | Yes | **Never** |
| Mutable | Rotated away | Append-only by database grant |

Conflating them fails in both directions: audit data disappears with log rotation, and logs
fill with PII. They are separate systems with separate guarantees.

## 2. Structured logging

Pino, JSON, one line per event, no string interpolation.

```json
{
  "level": "info",
  "time": "2026-09-20T11:42:07.812Z",
  "service": "api",
  "env": "production",
  "version": "1.4.2",
  "request_id": "01935f7c-8a1b-7def-9c3e-0242ac120002",
  "user_id": "0193...",
  "route": "POST /v1/me/orders",
  "status": 201,
  "duration_ms": 187,
  "msg": "order.placed",
  "order_id": "0193...",
  "total_paise": 32700,
  "slot_id": "0193...",
  "service_date": "2026-09-21"
}
```

**Always present:** `service`, `env`, `version`, `request_id`, `time`, `level`, `msg`.
**Never present:** name, phone, email, address, token, cookie, password, card data, full
request bodies.

A redaction layer in the logger strips sensitive keys by **allow-list** — a deny-list
eventually misses a newly added field, and the failure is silent. `user_id` is logged because
it is an opaque UUID that is useless without database access; `phone` is not.

**Correlation:** `request_id` flows from Cloudflare through the API, into background jobs it
triggers, into outbox events, and into Sentry. One id traces a customer complaint from the
click to the email.

**Log levels:** `error` = needs human attention; `warn` = handled but notable (rate limit,
validation failure spike); `info` = business events and request completion; `debug` = local
only.

## 3. Business events logged

`order.placed`, `order.status_changed`, `order.cancelled`, `subscription.created`,
`subscription.paused`, `subscription.resumed`, `subscription.cancelled`,
`subscription.delivery_generated`, `subscription.delivery_materialised`,
`subscription.delivery_failed`, `slot.capacity_exceeded`, `inventory.insufficient`,
`payment.collected`, `auth.session_created`, `auth.failed`, `authz.denied`,
`notification.sent`, `notification.failed`, `job.started`, `job.completed`, `job.failed`.

These sit between metrics (too coarse to debug) and traces (too fine to scan). They are what
makes "why did this customer not get their delivery?" answerable in one log query.

## 4. Error tracking — Sentry

All five deployables (api, worker, marketing, customer, admin) with release tracking and
source maps uploaded at build time.

Configuration: `beforeSend` scrubs PII from payloads, breadcrumbs and headers; expected
errors (`404`, `401`, `422`, validation failures) are **not** reported — they are normal
traffic and would bury real problems; unexpected errors carry `request_id`, `user_id`, route
and release; performance tracing samples 10% of transactions.

**Alerts:** any new issue in production; error rate > 1% over 5 minutes; a regression in a
previously resolved issue; any error in the checkout or subscription-materialisation path,
regardless of rate.

## 5. Metrics

Derived from structured logs at MVP rather than from a dedicated metrics backend — with this
volume, a log query answers every question a dashboard would, and a Prometheus stack would be
infrastructure to maintain for no additional insight.

| Category | Metrics |
|---|---|
| Traffic | Requests per route, status distribution, p50/p95/p99 latency |
| Errors | 5xx rate, 4xx rate by code, unhandled exceptions |
| Business | Orders placed/hour, revenue/day, AOV, subscription net change, cancellation rate |
| Fulfilment | Slot utilisation, `SLOT_FULL` rejections, slot adherence, prep lead time |
| Subscriptions | Deliveries generated, materialised, skipped, **failed** |
| Inventory | Out-of-stock events, oversell attempts, wastage |
| Notifications | Outbox depth, oldest pending age, per-channel send rate, bounce rate |
| Jobs | Run duration, success/failure, last successful run per job |
| Database | Connection pool usage, slow queries, table sizes |

## 6. Alerts

| Severity | Response | Examples |
|---|---|---|
| **P0 — page immediately** | Now | API down, database unreachable, checkout error rate > 5%, capacity rows missing for tomorrow, worker not run in 3h |
| **P1 — within 1 hour** | Same day | Error rate > 1%, subscription materialisation failures > 5, outbox depth > 500, p95 latency > 2× budget |
| **P2 — next business day** | Triage | Email bounce rate > 3%, low-stock backlog, slot utilisation > 90% for 3 days, `DEAD` outbox rows |
| **P3 — weekly review** | Review | Slow queries, dependency vulnerabilities, CWV drift |

**"Capacity rows missing for tomorrow" is P0** even though nothing has failed yet: without
those rows, every checkout tomorrow morning fails. The best alerts fire before the incident,
and this is the clearest example in the system.

Alert hygiene: every alert names an owner and an action; an alert that fires repeatedly
without action is deleted or fixed — alert fatigue is the leading cause of missed real
incidents.

## 7. Uptime monitoring

Cloudflare health checks every 60s on `https://api.maindomain.com/v1/health/ready` (must
return 200 and confirm database connectivity), plus checks on `maindomain.com`,
`app.maindomain.com` and `admin.maindomain.com`. Two consecutive failures alert; SSL
expiry is checked at 30, 14 and 7 days.

An external, independent monitor (Better Stack or UptimeRobot free tier) watches the same
endpoints, because a monitor hosted inside the thing it monitors cannot report its own
outage.

## 8. Job monitoring

`job_runs` (`job_name`, `started_at`, `finished_at`, `status`, `items_processed`,
`error`) records every scheduled run, surfaced in admin under Settings → Jobs.

**Dead-man's switch:** an alert fires when a job has *not* run within its expected window.
A failing job is loud; a job that silently stopped running is not, and the latter is how a
subscription business quietly stops delivering.

| Job | Expected | Alert if not seen in |
|---|---|---|
| `generate-subscription-deliveries` | daily 01:00 | 3h |
| `materialise-subscription-orders` | hourly | 2h |
| `roll-slot-capacity` | daily 00:30 | 2h |
| `dispatch-outbox` | every 15s | 5 min |
| `send-delivery-reminders` | daily 20:00 | 2h |

## 9. Audit logging

Specified in doc 04 §3.3 and doc 23 §12. Operationally:
- Written in the **same transaction** as the change it describes.
- Append-only: the application database role has no `UPDATE`/`DELETE` grant on the table.
- Visible in the admin UI with a before/after diff viewer, filterable by actor, action,
  resource and date.
- Retained 24 months, then archived to R2 as Parquet.
- Complements, never replaces, `order_status_history` and `subscription_events`, which are
  domain histories rather than governance records.

## 10. Dashboards

| Dashboard | Audience | Contents |
|---|---|---|
| Operations (admin UI) | Business | Today's orders, revenue, exceptions, slot load, low stock |
| System health (Railway + Sentry) | Engineering | Latency, error rate, CPU/memory, DB connections |
| Job health (admin UI) | Both | Last run, duration, outcome per job |
| Notifications (admin UI) | Both | Outbox depth, send rate, failures |
| Web vitals (Vercel) | Engineering | CWV p75 by route |

## 11. Debugging a real complaint

*"I didn't get my delivery this morning."*

```
1. Admin → Customers → search by phone → find the subscription
2. Subscription detail → delivery timeline → the date shows status FAILED
3. failure_reason: "SLOT_CAPACITY_EXCEEDED"
4. Logs: subscription.delivery_failed with that delivery_id → the attempt timeline
5. Notification log: SUBSCRIPTION_DELIVERY_FAILED email sent at 04:12
6. audit_logs: capacity for that slot/date was reduced by an admin at 22:40
   → root cause found, with a name against it
```

Every step is a first-class product feature rather than a log-diving exercise. That is the
observability requirement for this system: a support person, not an engineer, should be able
to answer the common questions.
