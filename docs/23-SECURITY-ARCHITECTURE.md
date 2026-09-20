# 23 — Security Architecture

## 1. Principles

1. **Defence in depth.** Cloudflare, the API, and the database each enforce what they can.
   No control is the only control.
2. **Secure by construction.** Ownership in the `WHERE` clause, permissions declared on the
   route, constraints in the schema — so that forgetting is impossible rather than merely
   discouraged.
3. **Least privilege** for staff, for service accounts, and for the database role.
4. **Assume the client is hostile.** Every input is validated server-side; nothing sent by a
   client is trusted, including prices, totals and ids.
5. **No secrets in the database, in the repository, or in logs.**
6. **Auditability.** Every privileged action is attributable to a person.

## 2. Division of responsibility

| Cloudflare | Application |
|---|---|
| TLS termination, HSTS, TLS 1.3 | Firebase token verification |
| DDoS and volumetric protection | Per-user rate limiting |
| WAF (OWASP managed rules) | Input validation (Zod) |
| Bot management | Permission checks (RBAC) |
| Coarse IP rate limiting | Ownership enforcement |
| Geo-blocking (optional) | Idempotency |
| Cloudflare Access on `admin.` | Session lifetime and revocation |
| Cache-poisoning protection | Output encoding, CSP |

Cloudflare handles **volume and network**; the application handles **identity and meaning**.
Neither substitutes for the other: Cloudflare cannot know whether order `X` belongs to
customer `Y`, and the application cannot absorb a 20 Gbps flood.

## 3. Authentication and session security

Detailed in [07-AUTHENTICATION-AUTHORIZATION.md](07-AUTHENTICATION-AUTHORIZATION.md).
Security-relevant summary:

- Two Firebase projects make cross-audience token use cryptographically impossible.
- ID tokens expire in 1 hour; `users.status` is checked on **every** request so suspension
  takes effect immediately.
- Admin sessions: `__Host-` prefixed, `HttpOnly`, `Secure`, `SameSite=Strict`, 12h maximum,
  30min idle timeout, server-side revocable via Firebase `revokeRefreshTokens`.
- No password, OTP or refresh token is ever stored by us.
- Firebase App Check on the customer project blocks scripted OTP abuse.

## 4. Authorization

- **Customers:** ownership only. `/v1/me/*` queries filter by the authenticated
  `customer_profile_id` **inside the SQL `WHERE` clause**. There is no fetch-then-check step
  to omit. Foreign resources return `404`, not `403`, so ids cannot be enumerated.
- **Admins:** every `ADMIN`-audience route declares a required permission. The route registry
  asserts this at boot, so an undeclared route crashes the service on deploy rather than
  shipping an unguarded endpoint.
- **Frontend guards are UX only** and are documented as such, so no reviewer mistakes them
  for a control.

## 5. Input validation

Every request body, query string and path parameter is parsed by a Zod schema from
`packages/contracts`. Unvalidated input never reaches a service.

- **Strict parsing** — unknown keys are stripped, not passed through. A client cannot smuggle
  `is_admin` or `price_paise` into an update by adding a field.
- **Allow-lists** for `sort`, `include` and filter fields; anything else is `422`.
- **Bounds** on every numeric and string field (quantity 1–99, limit ≤ 100, text lengths).
- **Business-field immutability** — server-computed fields (prices, totals, statuses, ids)
  are never accepted from the client. The only price the client sends is
  `expected_total_paise`, which is an assertion to compare against, never a value to use.
- **File uploads** are constrained by the presign, not by the client (§9).

## 6. Injection and output safety

| Threat | Control |
|---|---|
| SQL injection | Prisma parameterises everything; raw SQL uses `$queryRaw` tagged templates only. String-concatenated SQL is a CI failure via lint rule |
| ORM injection via filters | Sort/filter/include allow-lists; user input never becomes a column or table name |
| XSS (stored) | React escapes by default; `dangerouslySetInnerHTML` is banned by lint except for CMS content, which passes through a sanitiser allow-list |
| XSS (reflected) | No server-side templating of user input; strict CSP |
| CSRF | Admin: `SameSite=Strict` + `__Host-` + double-submit token. Customer: bearer tokens are not sent automatically by browsers, so CSRF does not apply |
| Clickjacking | `X-Frame-Options: DENY`, `frame-ancestors 'none'` |
| MIME sniffing | `X-Content-Type-Options: nosniff` |
| Open redirect | Redirect targets validated against an allow-list of our own hostnames |
| SSRF | No user-supplied URL is ever fetched server-side |
| Prototype pollution | Zod strict parsing; no deep-merge of client input |

### Security headers (all surfaces)
```
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
Content-Security-Policy: default-src 'self';
  script-src 'self' 'nonce-{random}';
  style-src 'self' 'unsafe-inline';
  img-src 'self' https://cdn.maindomain.com data: blob:;
  connect-src 'self' https://api.maindomain.com https://*.googleapis.com
              https://*.firebaseio.com https://identitytoolkit.googleapis.com;
  font-src 'self';
  frame-ancestors 'none';
  base-uri 'self';
  form-action 'self';
  object-src 'none';
  upgrade-insecure-requests
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(self), camera=(), microphone=(), payment=()
```
CSP is nonce-based, with `report-uri` to Sentry. It is rolled out in report-only mode first
so violations are found before they break a page.

## 7. CORS

```
Allowed origins (explicit list, no wildcard, no regex):
  https://maindomain.com
  https://www.maindomain.com
  https://app.maindomain.com
  https://admin.maindomain.com
  https://*.vercel.app   ← preview deployments, NON-PRODUCTION API only
Methods: GET, POST, PATCH, DELETE, OPTIONS
Headers: Authorization, Content-Type, Idempotency-Key, X-Request-Id, X-Client
Credentials: true (required for the admin session cookie)
Max-Age: 86400
```
Production never allows a wildcard or a preview origin. `Access-Control-Allow-Origin` is
echoed only after an exact match against the list. Native mobile apps send no `Origin`
header, so CORS simply does not apply to them — which is one more reason the API is not a
frontend route handler.

## 8. Rate limiting and abuse

| Layer | Scope | Limit |
|---|---|---|
| Cloudflare | Per IP, all endpoints | 600/min |
| Cloudflare | `POST /v1/auth/*` | 30/min |
| API | Per user, reads | 300/min |
| API | Per user, writes | 60/min |
| API | `POST /v1/me/orders` | 10/min |
| API | Admin writes | 120/min |
| Firebase | OTP per number/IP | Provider defaults |

Implemented as a Postgres-backed sliding window at MVP (sufficient for a single API
instance), with a documented migration to Redis when the API scales horizontally. Responses
carry `Retry-After` and `X-RateLimit-*`.

Additional abuse controls: Firebase App Check on OTP; per-customer address cap (10); maximum
cart quantity per line; maximum bulk-operation size (100); account lockout handled by
Firebase.

## 9. File and image uploads

```
1. Admin requests an upload → API checks catalog:create|update
2. API issues a presigned R2 PUT URL, 5-minute expiry, constrained by:
     Content-Type ∈ {image/jpeg, image/png, image/webp, image/avif}
     Content-Length ≤ 5MB
     key = products/{product_id}/{uuidv7}.{ext}   ← server-generated, never client-supplied
3. Browser uploads directly to R2 (bytes never transit our API)
4. Client confirms → row created with status PENDING
5. Worker validates magic bytes, decodes dimensions, strips EXIF (including GPS),
   generates the LQIP, then sets status READY
6. Only READY images are served
```

Controls that matter: the **key is generated server-side** (a client-supplied path is a
path-traversal and overwrite vector); **content type is enforced in the presign**, not merely
requested; **magic bytes are verified** because extensions and headers both lie; **EXIF is
stripped** because photographs carry GPS coordinates; and R2 serves from a separate CDN
hostname so an uploaded file can never execute in our origin's context.

## 10. Secrets

| Where | Managed by |
|---|---|
| API and worker | Railway environment variables |
| Frontends | Vercel environment variables, scoped per environment |
| CI | GitHub Actions encrypted secrets and environments |
| Local | `.env.local`, git-ignored; `.env.example` documents keys with placeholder values |

Rules: no secret in the repository, ever; Gitleaks runs in CI and as a pre-commit hook; keys
are rotated quarterly and immediately on any suspected exposure; the Firebase Admin service
account is stored as a base64 single-line variable, never as a committed file; `DATABASE_URL`
exists only on Railway services; `NEXT_PUBLIC_*` variables are assumed public by definition,
and a server-only secret with that prefix fails a CI check.

## 11. Data protection and PII

**PII inventory:** name, phone, email, address, location coordinates, order history,
delivery instructions.

| Control | Implementation |
|---|---|
| In transit | TLS 1.3 everywhere, HSTS preload |
| At rest | Railway Postgres encryption at rest; R2 encryption at rest |
| In logs | **Never.** A redaction layer in the Pino logger strips phone, email, address, token and payment fields by allow-list |
| In URLs | Never — no PII in paths, query strings, or analytics events |
| In errors | Sentry `beforeSend` scrubs PII from payloads and breadcrumbs |
| In admin UI | Phone and email masked unless `customers:read_pii`; unmasking is audited with a reason |
| In exports | PII columns require `reports:export` and every export is audited |
| Retention | Doc 04 §15 |
| Erasure | Anonymise-in-place; financial records retained with a tombstoned customer reference |

**Database role least privilege:** the application connects as a role with `SELECT`,
`INSERT`, `UPDATE`, `DELETE` on application tables and **no** `DROP`, no `ALTER`, and no
`UPDATE`/`DELETE` on `audit_logs`. Migrations run as a separate, higher-privileged role used
only by the deploy job. An application-level SQL injection therefore cannot drop a table or
rewrite the audit trail.

## 12. Audit logging

Every admin mutation writes an `audit_logs` row **in the same transaction as the change** —
so an audit entry cannot be missing for a change that succeeded, and cannot exist for one
that rolled back.

Recorded: actor id and email snapshot, action, resource type and id, before/after diff of
changed fields only (PII-redacted), reason where required, IP, user agent, request id,
timestamp. Append-only by database grant. Retained 24 months, then archived.

Security events specifically logged: failed authentication, `FORBIDDEN` denials, PII
unmasking, role and permission changes, admin account lifecycle, settings changes, rate-limit
breaches, and webhook signature failures. **Denials are the interesting signal** — a spike in
403s is how an attempted privilege escalation is detected.

## 13. Idempotency and replay

`POST /v1/me/orders`, `POST /v1/me/subscriptions` and all payment mutations require an
`Idempotency-Key`. Keys are scoped per user, stored with a hash of the canonical body, and
retained 24 hours. Replay with the same body returns the stored response; replay with a
different body returns `422 IDEMPOTENCY_KEY_REUSED` rather than silently doing the wrong
thing. Webhooks dedupe on the provider's event id (doc 19 §6).

## 14. Threat model summary

| Threat | Impact | Controls |
|---|---|---|
| Credential stuffing | Account takeover | No passwords for customers; Firebase lockout for admins; rate limits |
| Session theft via XSS | Admin takeover | `HttpOnly` cookies, strict CSP, lint bans |
| Privilege escalation | Full compromise | Separate Firebase projects, boot-time route assertion, `roles:manage` restricted to Super Admin |
| IDOR on orders/addresses | Data breach | Ownership in the `WHERE` clause, 404-over-403, UUIDv7 |
| Price manipulation | Financial loss | Server-side re-pricing; client prices are never trusted |
| Slot over-booking | Operational failure | Row lock + `CHECK` constraint |
| Duplicate subscription orders | Financial and trust loss | Unique constraints (doc 11 §5) |
| Inventory oversell | Fulfilment failure | Row lock + `CHECK` constraint |
| Replay / double submit | Duplicate orders | Idempotency keys |
| Webhook forgery | Fake payments | Raw-body signature verification, dedupe, amount re-verification |
| Malicious upload | RCE / stored XSS | Presign constraints, magic bytes, separate CDN origin |
| Secret leakage | Full compromise | Gitleaks, platform secret stores, rotation |
| SQL injection | Data breach | Parameterised queries, lint rule, least-privilege DB role |
| DDoS | Outage | Cloudflare |
| Insider misuse | Data misuse | RBAC, PII masking, audit logs, export gating |

## 15. Practices

- **Dependencies:** Renovate weekly; `pnpm audit` and CodeQL in CI; critical CVEs patched
  within 48 hours.
- **Code review:** every PR reviewed; security-sensitive paths (auth, payments, orders,
  permissions) require an explicit security checklist in the PR template.
- **Pre-launch:** dependency audit, header and TLS scan, OWASP Top 10 review, authorization
  matrix test (every role against every endpoint), penetration test if budget allows.
- **Incident response:** doc 29 §7.
- **Ongoing:** quarterly access review of admin accounts and roles; quarterly key rotation;
  monthly review of denial and auth-failure logs.
