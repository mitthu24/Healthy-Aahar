# 07 — Authentication & Authorization

> **CURRENT (PHASE 03): email + password, verified and sessioned entirely by this system's own
> PostgreSQL.** No external auth provider is part of the active path. Firebase — this doc's
> original design (ADR-009, ADR-010) — is a documented **FUTURE** option only; see §11. This
> change is recorded in `36-DECISIONS-LOG.md` ADR-037/038.

## 1. Separation of concerns

| Concern | Owner |
|---|---|
| Proving who someone is (password hashing, session-token issuance/verification) | **This API** (`packages/auth`, scrypt + DB-backed sessions) |
| Who that person is *to our business* (profile, orders, subscriptions) | **Our PostgreSQL** |
| What that person may do | **Our PostgreSQL** (RBAC) |
| Whether the account is still allowed in | **Our PostgreSQL** (`users.status`), checked per request |

Passwords are never stored in plaintext or logged — only a scrypt hash
(`packages/auth/src/password.ts`). Session tokens are never stored raw — only a SHA-256 hash
(`packages/auth/src/session-token.ts`). If our database leaks, no password or session is
recoverable from it; only the hashes are, and neither hash function is invertible.

## 2. One identity space, two audiences

**ADR-037 (supersedes ADR-010 for the current phase).** Customers and staff are both rows in
the same `users` table, distinguished by `user_type`:

| | Customer | Admin |
|---|---|---|
| Method | Email + password | Email + password |
| Sign-up | Self-service (`POST /v1/auth/register`) | **Invite only** — no public sign-up |
| Identity key | `(email, user_type='CUSTOMER')` | `(email, user_type='ADMIN')` |
| Session transport | `Authorization: Bearer <token>` | `__Host-` session cookie |
| Session lifetime | 30 days, no idle timeout (mobile-readiness, §10) | 12h absolute, 30m idle |

### Why `user_type` rather than two separate databases/projects

The Firebase-era design used two entirely separate Firebase projects so a token's audience
claim made cross-audience use cryptographically impossible before any application code ran
(ADR-010). Under DB-backed sessions there is no token audience to mis-check — `AdminAuthService
.login` and `CustomerAuthService.login` each query `users` with their OWN `user_type` baked
into the lookup (`findByEmail(email, 'ADMIN')` vs. `findByEmail(email, 'CUSTOMER')`), so an
admin's credentials simply do not match any row when attempted against the customer login
path, and vice versa — the separation is structural (two code paths, two queries), not a claim
that could be forged or a check that could be forgotten on one route.

A person who is both a customer and a staff member holds two `users` rows — one per
`user_type` — exactly as the Firebase-era design also required (`UNIQUE (email, user_type)`,
not `UNIQUE (email)`).

## 3. Identity model

```
                    users
  id (UUID) ← our internal identity, used everywhere
  email, phone, user_type, password_hash, status
  UNIQUE (email, user_type)
  firebase_uid — nullable, unused by PHASE 03, kept for §11
          │                               │
┌─────────▼──────────┐          ┌─────────▼──────────┐
│ customer_profiles   │          │   admin_users       │
│ names, LTV, prefs   │          │ full_name, MFA,     │
│ default address     │          │ is_super_admin      │
└─────────┬───────────┘          └─────────┬───────────┘
          │                                │
 orders, subscriptions,           admin_user_roles → roles
 addresses, favourites                     → role_permissions → permissions

                  sessions
  id, user_id, token_hash (unique), expires_at,
  last_seen_at, revoked_at, ip_address, user_agent

          password_reset_tokens
  id, user_id, token_hash (unique), purpose (SETUP | RESET),
  expires_at, used_at
```

**Rule:** every foreign key in the system points at `users.id` or a profile id, never at a
session token or its hash. A session is purely a bearer of "this request is `users.id = X`
until `expires_at`, unless revoked sooner" — it carries no other claim.

## 4. Customer authentication — email + password

### 4.1 Why email + password for the CURRENT phase

Phone OTP (the original MVP design, ADR-009) required Firebase to deliver and verify the SMS.
With Firebase out of the active path (ADR-037), password auth is what this system can
implement and verify entirely on its own infrastructure. Phone OTP remains a documented future
option when Firebase (or an equivalent OTP provider) is reintroduced — see §11.

### 4.2 Flow

```mermaid
sequenceDiagram
  participant U as Customer
  participant App as Customer web app
  participant API as api.healthyaahar.com
  participant DB as PostgreSQL

  U->>App: enters email + password
  App->>API: POST /v1/auth/register (first time) or /v1/auth/login
  API->>DB: SELECT users WHERE (email, user_type='CUSTOMER')
  alt register, email not taken
    API->>DB: BEGIN; INSERT users (password_hash=scrypt(...)) + customer_profiles;<br/>outbox CUSTOMER_REGISTERED; INSERT sessions; COMMIT
    API-->>App: 201 { user, profile, token }
  else login, password verifies
    API->>DB: INSERT sessions; UPDATE last_login_at
    API-->>App: 200 { user, profile, token }
  end
  App->>App: holds `token` in memory (web) / secure storage (future native);<br/>never localStorage, never a JS-readable cookie
```

Every subsequent customer request sends `Authorization: Bearer <token>`; the API hashes it,
looks up `sessions.token_hash`, and resolves the `Actor` — no separate "session cookie" exists
for the customer audience (§10).

### 4.3 Token handling in the customer app

- The frontend holds the raw token only in memory for the lifetime of the tab/session; it is
  never written to `localStorage`, `sessionStorage`, or any cookie the frontend itself sets.
- Every API call attaches `Authorization: Bearer <token>`.
- On `401 UNAUTHENTICATED` / `401 SESSION_EXPIRED` the client clears its in-memory token and
  routes to sign-in. There is no silent refresh — a session is valid for its full 30-day
  lifetime or it is not; re-authenticating is the only path back.

### 4.4 Abuse controls

Login **and registration** attempts are each rate-limited per IP **and** per email
independently (`LOGIN_RATE_LIMIT_PER_MIN` / `REGISTER_RATE_LIMIT_PER_MIN`,
`apps/api/src/middleware/rate-limit.ts`#`assertAuthRateLimit`) — Step 6's brute-force
protection. Registration is checked in its own bucket, separate from login's, so hammering
one can never lock a caller out of the other; both buckets normalise the email (trim +
lower-case) so trivial casing/whitespace variants cannot each get a fresh attempt budget.
Cloudflare rate-limits the endpoint coarsely at the edge as a second, independent layer.

**Known limitation:** the rate-limit store is in-process (`InMemoryRateLimitStore`) — correct
for today's single API instance (`railway.json`), but each additional instance would enforce
the configured limit independently rather than sharing one counter, effectively multiplying
the real limit by the instance count. This must move to a shared store (Redis, PD-14) before
the API ever runs as more than one instance; see the module doc comment in
`apps/api/src/middleware/rate-limit.ts` for the full reasoning.

## 5. Admin authentication

### 5.1 Flow
1. Super admin invites a staff member: the API creates the `users` row directly (no
   `password_hash` yet) and the `admin_users` + role-grant rows in one transaction, then issues
   a one-time password-setup token (`PasswordResetService.issueToken`, 7-day expiry, purpose
   `SETUP`) and returns it to the caller as `password_setup_link` — no external email send is
   wired into this phase; the caller (today: whoever called the invite API) delivers it. There
   is no public admin sign-up route.
2. The staff member calls `POST /v1/auth/password/setup` with that token and their chosen
   password, which sets `users.password_hash` and revokes any session that could otherwise
   survive the credential being established. The token is claimed atomically (one conditional
   `UPDATE ... WHERE used_at IS NULL`, never a separate read-then-write) — two concurrent
   requests presenting the same token cannot both succeed.
3. Sign-in at `admin.healthyaahar.com` calls `POST /v1/admin/auth/login` with email + password.
4. A successful login creates a `sessions` row and sets the session cookie to the raw token
   (the DB stores only its hash).

**Existing admin, no password (Fix #2):** an admin row created before this credential existed
— or one who never completed step 2 — has no self-service recovery route; there is
deliberately no public "forgot password" endpoint for admins (every admin credential action
requires an already-authenticated, permissioned actor — docs/23 §4). A Super Admin issues them
a fresh token instead:
`POST /v1/admin/admin-users/{id}/reset-password` (permission `admin_users:update`, purpose
`RESET`, same token mechanism as step 1, fully audited as `admin_user.password_reset_issued`).
This is the one authorized workflow for an admin who already exists to obtain a new setup
link — `inviteAdmin` cannot be reused for this (it always creates a new `users` row, which
collides on the existing one's email and returns `ADMIN_ALREADY_INVITED`).

**Customer password reset — foundation only, not yet exposed:** `PasswordResetService` is
audience-agnostic (the token identifies a `userId` directly, admin or customer), so the same
mechanism is ready for a customer "forgot password" flow. No route calls it for customers yet.
Building one safely needs a product decision this system cannot make for itself: how the link
is delivered (an email/SMS provider — `NOTIFICATIONS_ENABLED`/Brevo wiring is out of this
phase's scope) and the exact anti-enumeration shape of the response (the standard pattern is
"if an account with that email exists, a link was sent" regardless of whether it does — but
committing to that wording, and to a delivery channel, is a product call). Until that decision
is made, there is no customer-facing route for this — the service-level piece is ready, the
product decision is not.

### 5.2 Why the admin panel uses a cookie and the customer app does not

Unchanged from the original design (ADR-038 reaffirms it under DB-backed sessions): the admin
panel is a long-lived internal tool on a single trusted origin, where an XSS bug is
catastrophic — an `HttpOnly` cookie is unreadable by JavaScript, so a script injection cannot
exfiltrate the session. The customer app keeps the bearer pattern because a planned native
mobile client cannot use a browser cookie jar, and docs/30's mobile-readiness claim depends on
customer auth staying transport-identical for web and native.

**Cookie configuration**
```
__Host-admin_session=<raw session token>
  HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=43200 (12h)
```
- `__Host-` prefix forces `Secure`, `Path=/` and no `Domain` — it cannot be set by a
  subdomain, which blocks subdomain-takeover session fixation.
- `SameSite=Strict` removes CSRF for state-changing requests. A double-submit CSRF token is
  **also** issued as defence in depth, because `SameSite` is a browser behaviour, not a
  server guarantee (doc 23 §6).
- The cookie's own value is now this system's `sessions.token_hash` lookup key in disguise —
  revocation is a single `UPDATE sessions SET revoked_at = now()`, with no external call.
- 12-hour maximum (`expires_at`, set once at login), with a 30-minute idle timeout enforced
  against `sessions.last_seen_at` on every request — **this is newly enforced under PHASE 03**;
  the Firebase-era design declared the same env var but never checked it (see ADR-037's
  "Known limitations" discussion in the PHASE 03 report).

### 5.3 Admin security requirements

| Control | Status |
|---|---|
| Password policy (scrypt, 10–256 chars, length-based per NIST 800-63B) | ✅ |
| No public sign-up | ✅ |
| `users.status` checked every request | ✅ |
| All mutations audited | ✅ |
| Session revocation on deactivate (every session, not just the current one) | ✅ |
| Idle timeout | ✅ (now actually enforced — see above) |
| Login rate limiting (per IP and per email) | ✅ |
| Cloudflare Access / IP allow-list in front of `admin.` | recommended at launch |
| Mandatory MFA | not yet — `admin_users.mfa_enabled` exists, unused |
| Per-role session lifetime | not yet |

## 6. Session verification in the API

```ts
// packages/core — conceptual, not implementation
type Actor =
  | { kind: 'CUSTOMER'; userId: string; customerProfileId: string }
  | { kind: 'ADMIN'; userId: string; adminUserId: string;
      permissions: ReadonlySet<string>; isSuperAdmin: boolean }
  | { kind: 'SYSTEM'; jobName: string }
  | { kind: 'ANONYMOUS' };
```

Every request resolves to exactly one `Actor` before any handler runs. Handlers receive the
`Actor`; they never read headers, cookies or tokens themselves.

**Verification steps (per request), `validateSession` (`packages/core/src/services/session-validation.ts`):**
1. Extract the bearer token (customer) or the admin session cookie.
2. Hash it (SHA-256) and look up `sessions` by `token_hash`.
3. No row ⇒ `401 UNAUTHENTICATED`. Row found but `revoked_at` set, `expires_at` passed, or (admin
   only) idle beyond `ADMIN_SESSION_IDLE_TIMEOUT_SECONDS` ⇒ `401 SESSION_EXPIRED`.
4. Throttled write: bump `last_seen_at` if more than 60s have passed since it was last updated.
5. Load `users` by the session's `user_id`. Reject if `users.status <> 'ACTIVE'` ⇒
   `403 ACCOUNT_SUSPENDED`.
6. For admins, load effective permissions (60-second in-process cache, invalidated on any
   role change).
7. Attach the `Actor` to the request context.

**Performance:** step 2 is a single indexed lookup (`sessions.token_hash` is a unique index);
steps 4–5 are one more indexed query each. No cryptographic verification (no signature check,
no public-key fetch) is needed — the token's validity IS its presence as an unrevoked,
unexpired row, which is actually less CPU work per request than the Firebase-era JWT
verification path.

**Why `users.status` is checked on every request:** a session row can remain valid for its
full configured lifetime (up to 12h for admins, 30 days for customers). Suspending an account
must take effect on the very next request, not wait for that lifetime to elapse (BR-SEC3). This
is unchanged from the Firebase-era design and was already true there for the same reason.

## 7. Authorization

Authentication answers *who*; authorization answers *what*. They are separate middleware, and
this layer is unchanged by the PHASE 03 auth-method swap — it has no dependency on how the
`Actor` was resolved.

- **Customers** have no roles. Authorization is **ownership**: every `/v1/me/*` query filters
  by the authenticated `customer_profile_id` inside the `WHERE` clause. There is no
  "fetch then check" step to forget, and a resource that is not yours returns `404`
  (doc 06 §1.6).
- **Admins** have roles and permissions, specified in
  [08-RBAC-PERMISSIONS.md](08-RBAC-PERMISSIONS.md). Each route declares a required
  permission key; middleware enforces it; the OpenAPI document publishes it.
- **System** actors (worker jobs) bypass permission checks but are still recorded as
  `actor_type='SYSTEM'` in audit and status history.

### 7.1 Route protection in the frontends

Frontend guards are **UX, not security**. The customer app redirects unauthenticated users to
sign-in; the admin panel hides menu items the user lacks permission for. Both are convenience
layers over an API that independently rejects the request. A reviewer who sees a permission
check *only* in the frontend must treat it as a bug.

## 8. Account lifecycle

| Event | Our DB |
|---|---|
| Customer registers | `users` (with `password_hash`) + `customer_profiles` inserted; a session is created |
| Customer changes password | `password_reset_tokens` consumed; `users.password_hash` updated; every existing session revoked |
| Customer suspended | `users.status='SUSPENDED'` |
| Customer deletion request (P2) | PII anonymised; orders retained with a tombstoned reference |
| Admin invited | `users` (no `password_hash` yet) + `admin_users` + roles; a password-setup token issued |
| Admin completes setup | `users.password_hash` set; the setup token is marked used and cannot be replayed |
| Admin deactivated | `users.status='DEACTIVATED'`, `admin_users.deleted_at`, every session revoked |
| Role changed | `admin_user_roles` updated; permission cache invalidated; audited |

**Deletion and financial records:** orders, payments and inventory movements are financial
records and are never deleted. On an erasure request the customer's name, phone, email and
addresses are replaced with tombstones, `users.password_hash` and `users.firebase_uid` are
nulled, and every session is revoked. The order row survives with its `address_snapshot`
redacted to city + pincode — enough for accounting, insufficient to identify a person.

## 9. Threats and mitigations

| Threat | Mitigation |
|---|---|
| Stolen session token | Hashed at rest (never stored raw); admin session revocable instantly; HTTPS only; finite lifetime |
| XSS stealing an admin session | `HttpOnly` cookie, strict CSP, no `dangerouslySetInnerHTML` without sanitisation |
| CSRF on admin mutations | `SameSite=Strict` + `__Host-` prefix + double-submit CSRF token |
| Brute force / spam on login AND registration | Per-IP and per-email rate limiting, independent buckets per endpoint (Fix #1); Cloudflare rate limiting |
| Resource exhaustion via unlimited unauthenticated scrypt computations | Same rate limiting — registration used to have none at all (Fix #1) |
| Password database leak | scrypt (memory-hard), per-password random salt — not reversible at scale |
| Privilege escalation via role edit | `roles:*` restricted to Super Admin; last-super-admin invariant; every change audited |
| Enumerating accounts via login | Generic `INVALID_CREDENTIALS` for unknown email, wrong password, AND no-password-yet — indistinguishable responses, constant-time-equivalent handling |
| Enumerating other customers' orders | Ownership in the `WHERE` clause; 404 not 403; UUIDv7 ids |
| Session fixation via subdomain | `__Host-` cookie prefix |
| Replay of a captured request | Idempotency keys; TLS |
| Stale/replayed password-setup link | One-time token (`used_at`), 7-day expiry, hashed at rest |
| Two concurrent requests both redeeming the same password-setup link | Atomic conditional claim (`consume`, Fix #2) — a separate read-then-write had a real race window here before |
| Cross-audience session-token reuse (a customer token presented as the admin cookie, or vice versa) | Explicit `userType` check in each `resolveActor` (Fix #4) — the failure mode is the established auth error either way, never a 500 or a granted session |
| Duplicate admin invite returning an unhandled error that could leak internals | Mapped to the existing `ADMIN_ALREADY_INVITED` 409, matched narrowly so an unrelated database error is never mislabeled as this (Fix #3) |

## 10. Mobile readiness

The customer flow stays mobile-shaped under PHASE 03: `POST /v1/auth/register` /
`POST /v1/auth/login` return a bearer token identically for a web or a native client, and
every other customer route reads the same `Authorization: Bearer` header either way — no
cookie, no platform-specific SDK. The native apps differ only in where they store the token
(platform secure storage instead of an in-memory JS variable) and in registering a push token
via `POST /v1/me/devices`. See [30-API-MOBILE-APP-READINESS.md](30-API-MOBILE-APP-READINESS.md).

## 11. Future: Firebase

The original design (this document's content before PHASE 03's ADR-037/038) used Firebase
Authentication: phone OTP for customers, two separate Firebase projects for audience
separation, Firebase session cookies for the admin panel. It is **not** part of the active
authentication path, but it remains a deliberately preserved option, not a rejected one:

- `users.firebase_uid` is nullable, unused, and not dropped — exactly the column a
  reintroduction would populate.
- `FIREBASE_*` environment variables are still declared (optional, unvalidated) in the server
  env schema, for the same reason.
- `packages/auth`'s port-based design (`PasswordHasher`, `SessionTokenHasher` ports with a
  Prisma-backed adapter) means a Firebase-backed `TokenVerifierPort`-style adapter could be
  reintroduced as a parallel identity source without redesigning RBAC, business isolation, or
  the `Actor` model — all three are already decoupled from how an `Actor` is established.

Reintroducing Firebase would be a new ADR, not a revert: it would need to decide how it
coexists with the password credential this phase establishes (dual-credential accounts,
migration, or a hard cutover), which is a product decision this document does not make in
advance.
