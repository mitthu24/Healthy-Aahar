# 07 — Authentication & Authorization

## 1. Separation of concerns

| Concern | Owner |
|---|---|
| Proving who someone is (OTP delivery, password hashing, token issuance, token signing) | **Firebase Authentication** |
| Who that person is *to our business* (profile, orders, subscriptions) | **Our PostgreSQL** |
| What that person may do | **Our PostgreSQL** (RBAC) — never Firebase claims alone |
| Whether the account is still allowed in | **Our PostgreSQL** (`users.status`), checked per request |

We never store passwords, OTP codes, refresh tokens or any credential material. If our
database leaks, no one can authenticate with it. That is the point of using Firebase.

## 2. Two Firebase projects, not one

**ADR-010.** Customers and staff live in **separate Firebase projects**:

| | Customer | Admin |
|---|---|---|
| Project | `healthly-customer` | `healthly-admin` |
| Methods (MVP) | Phone OTP | Email + password |
| Sign-up | Self-service | **Invite only** — no public sign-up |
| Token audience (`aud`) | `healthly-customer` | `healthly-admin` |
| Verified by | `customerAuth` verifier | `adminAuth` verifier |
| Session in browser | Bearer ID token from the SDK | `__Host-` session cookie |

### Why two projects rather than one project with a role claim

A single project means a customer token and an admin token are cryptographically
indistinguishable — the *only* thing separating them is our code correctly reading a custom
claim on every admin route. One missing check and a customer token authenticates against the
admin API.

With two projects, `admin.verifyIdToken()` rejects a customer token outright: the audience
does not match, so verification fails before any application logic runs. Privilege escalation
via a forgotten check becomes impossible rather than merely unlikely.

Additional benefits:
- Customer self-sign-up is enabled in one project and disabled in the other. Someone
  discovering the admin Firebase config cannot create an account with it.
- MFA, session duration and password policy can be strict for staff without punishing
  customers.
- A compromised customer-project API key has no bearing on the admin project.

**Cost:** two SDK initialisations, two sets of environment variables, and a person who is
both a customer and an admin holds two identities. All three are acceptable and are handled
explicitly (`users` is keyed on `(firebase_uid, user_type)`, so both rows can coexist).

## 3. Identity model

```
Firebase User (customer project)          Firebase User (admin project)
  uid: "fb_abc123"                          uid: "fb_xyz789"
  phone: +919876543210                      email: ops@maindomain.com
          │                                         │
          │ firebase_uid + user_type='CUSTOMER'     │ firebase_uid + user_type='ADMIN'
          ▼                                         ▼
      ┌─────────────────────────────────────────────────────┐
      │  users                                              │
      │  id (UUID)  ← our internal identity, used everywhere │
      │  firebase_uid, user_type, email, phone, status      │
      │  UNIQUE (firebase_uid, user_type)                   │
      └───────────┬─────────────────────────┬───────────────┘
                  │                         │
        ┌─────────▼──────────┐    ┌─────────▼──────────┐
        │ customer_profiles  │    │   admin_users      │
        │ names, LTV, prefs  │    │ full_name, MFA,    │
        │ default address    │    │ is_super_admin     │
        └─────────┬──────────┘    └─────────┬──────────┘
                  │                         │
       orders, subscriptions,        admin_user_roles → roles
       addresses, favourites                → role_permissions → permissions
```

**Rule:** `firebase_uid` appears in exactly one table (`users`) and is used for exactly one
purpose (mapping a verified token to `users.id`). Every foreign key in the system points at
`users.id` or a profile id, never at a Firebase UID. Migrating away from Firebase would then
touch one column and one middleware.

## 4. Customer authentication — phone OTP

### 4.1 Why phone OTP as the only MVP method

- The delivery address needs a working phone number anyway; OTP verifies it as a side effect.
- Indian consumers expect it; passwords are friction and a support burden.
- No password reset flow, no credential stuffing, no password storage.
- Firebase handles SMS delivery, rate limiting and the abuse surface.

Email/password is added in P2 for customers who prefer it, and account linking is already
supported by Firebase. Google sign-in is deliberately deferred: it introduces an
email-without-phone identity, which then needs a separate phone-collection step before the
first delivery — the friction we were trying to remove.

### 4.2 Flow

```mermaid
sequenceDiagram
  participant U as Customer
  participant App as Customer web app
  participant FB as Firebase (customer project)
  participant API as api.maindomain.com
  participant DB as PostgreSQL

  U->>App: enters +91 98765 43210
  App->>FB: signInWithPhoneNumber (reCAPTCHA / App Check)
  FB-->>U: SMS OTP
  U->>App: enters 6-digit code
  App->>FB: confirmationResult.confirm(code)
  FB-->>App: Firebase User + ID token (1h)
  App->>API: POST /v1/auth/session  (Bearer ID token)
  API->>FB: verifyIdToken (cached public keys)
  FB-->>API: decoded { uid, phone_number, aud, exp }
  API->>DB: SELECT users WHERE firebase_uid AND user_type='CUSTOMER'
  alt first time
    API->>DB: BEGIN; INSERT users + customer_profiles;<br/>outbox CUSTOMER_REGISTERED; COMMIT
    API-->>App: 201 { user, profile }
  else returning
    API->>DB: UPDATE last_login_at
    API-->>App: 200 { user, profile }
  end
  App->>App: store nothing; the Firebase SDK owns the token
```

### 4.3 Token handling in the customer app

- The Firebase JS SDK holds the refresh token in IndexedDB and silently refreshes the 1-hour
  ID token. **We do not implement token storage ourselves.**
- Every API call attaches `Authorization: Bearer <fresh ID token>` via an SDK interceptor
  that calls `getIdToken()` (which returns the cached token and refreshes only when needed).
- On `401 TOKEN_EXPIRED` the client force-refreshes once and retries exactly once; a second
  401 signs the user out.
- We do **not** use a session cookie for the customer app: the same bearer-token pattern is
  what the mobile apps will use, so there is one auth path to reason about and test.

### 4.4 Abuse controls
Firebase App Check (reCAPTCHA Enterprise on web, Play Integrity / DeviceCheck on mobile) is
enabled on the customer project so OTP cannot be farmed by scripts. Firebase per-number and
per-IP SMS quotas stay at their defaults; Cloudflare rate-limits the session endpoint.

## 5. Admin authentication

### 5.1 Flow
1. Super admin invites a staff member: the API creates the Firebase user in the **admin**
   project with a random password, creates `users` + `admin_users` rows, assigns roles, and
   emails a password-reset link via Brevo. There is no public admin sign-up route.
2. The staff member sets a password through Firebase's reset flow.
3. Sign-in at `admin.maindomain.com` yields a Firebase ID token.
4. The panel calls `POST /v1/admin/auth/session`, which verifies the token and sets a
   **session cookie**.

### 5.2 Why the admin panel uses a cookie and the customer app does not

The admin panel is a long-lived internal tool on a single trusted origin, where an XSS bug is
catastrophic. An `HttpOnly` cookie is unreadable by JavaScript, so a script injection cannot
exfiltrate the session. The customer app needs the bearer pattern because mobile apps cannot
use cookies across a native HTTP client cleanly, and consistency there matters more.

**Cookie configuration**
```
__Host-admin_session=<firebase session cookie>
  HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=43200 (12h)
```
- `__Host-` prefix forces `Secure`, `Path=/` and no `Domain` — it cannot be set by a
  subdomain, which blocks subdomain-takeover session fixation.
- `SameSite=Strict` removes CSRF for state-changing requests. A double-submit CSRF token is
  **also** issued as defence in depth, because `SameSite` is a browser behaviour, not a
  server guarantee (doc 23 §6).
- Created with Firebase's `createSessionCookie()`, which lets us revoke server-side.
- 12-hour maximum, with a 30-minute idle timeout enforced by the API against
  `last_activity_at`.

### 5.3 Admin security requirements

| Control | MVP | Later |
|---|---|---|
| Strong password policy (Firebase) | ✅ | |
| No public sign-up | ✅ | |
| `users.status` checked every request | ✅ | |
| All mutations audited | ✅ | |
| Session revocation on deactivate | ✅ | |
| Idle timeout | ✅ | |
| Cloudflare Access / IP allow-list in front of `admin.` | ✅ (recommended at launch) | |
| Mandatory MFA | | P2 — `admin_users.mfa_enabled` exists now |
| Per-role session lifetime | | P3 |

## 6. Token verification in the API

```ts
// packages/auth — conceptual, not implementation
type Actor =
  | { kind: 'CUSTOMER'; userId: string; customerProfileId: string }
  | { kind: 'ADMIN'; userId: string; adminUserId: string;
      permissions: ReadonlySet<string>; isSuperAdmin: boolean }
  | { kind: 'SYSTEM'; jobName: string }
  | { kind: 'ANONYMOUS' };
```

Every request resolves to exactly one `Actor` before any handler runs. Handlers receive the
`Actor`; they never read headers or tokens themselves.

**Verification steps (per request):**
1. Extract the bearer token or the admin session cookie.
2. Verify signature and claims with the **audience-matching** verifier. Firebase public keys
   are cached in memory with their `max-age`; verification is local and adds no network hop.
3. Reject if `exp` has passed, if `aud`/`iss` do not match the expected project, or if
   `auth_time` is older than the maximum session age for admins.
4. Load `users` by `(firebase_uid, user_type)`. Missing ⇒ `401` (`/v1/auth/session` is the
   only endpoint that may create a user).
5. Reject if `users.status <> 'ACTIVE'` ⇒ `403 ACCOUNT_SUSPENDED`.
6. For admins, load effective permissions (60-second in-process cache, invalidated on any
   role change).
7. Attach the `Actor` to the request context.

**Performance:** steps 1–3 are pure CPU. Steps 4–6 are one indexed query plus a cache hit.
Measured budget: under 5 ms p95.

**Why `users.status` is checked on every request:** a Firebase ID token remains
cryptographically valid until it expires (up to an hour). Suspending an account in Firebase
does not invalidate tokens already issued. Checking our own row makes suspension effective
on the very next request. For admins we additionally call `revokeRefreshTokens()` and verify
`auth_time > tokens_valid_after_time`, which closes the window entirely (BR-SEC3).

## 7. Authorization

Authentication answers *who*; authorization answers *what*. They are separate middleware.

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

Admin middleware (`apps/admin/middleware.ts`) checks for the session cookie's presence to
avoid rendering a shell that will only fail — it does not verify the cookie, because that is
the API's job and duplicating verification would duplicate the risk of getting it wrong.

## 8. Account lifecycle

| Event | Firebase | Our DB |
|---|---|---|
| Customer first sign-in | User created | `users` + `customer_profiles` inserted |
| Customer changes phone | Firebase re-verifies | `users.phone` updated after verification |
| Customer suspended | Account disabled | `users.status='SUSPENDED'` |
| Customer deletion request (P2) | Deleted after grace period | PII anonymised; orders retained with a tombstoned reference |
| Admin invited | User created, random password | `users` + `admin_users` + roles |
| Admin deactivated | Disabled + refresh tokens revoked | `users.status='DEACTIVATED'`, `admin_users.deleted_at` |
| Role changed | — | `admin_user_roles` updated; permission cache invalidated; audited |

**Deletion and financial records:** orders, payments and inventory movements are financial
records and are never deleted. On an erasure request the customer's name, phone, email and
addresses are replaced with tombstones, `users.firebase_uid` is nulled, and the Firebase user
is deleted. The order row survives with its `address_snapshot` redacted to
city + pincode — enough for accounting, insufficient to identify a person.

## 9. Threats and mitigations

| Threat | Mitigation |
|---|---|
| Customer token used on admin API | Different Firebase projects ⇒ audience mismatch ⇒ verification fails |
| Stolen ID token | 1-hour expiry, `users.status` check, admin session revocation, HTTPS only |
| XSS stealing an admin session | `HttpOnly` cookie, strict CSP, no `dangerouslySetInnerHTML` without sanitisation |
| CSRF on admin mutations | `SameSite=Strict` + `__Host-` prefix + double-submit CSRF token |
| OTP farming / SMS pumping | Firebase App Check, Firebase quotas, Cloudflare rate limits |
| Brute force on admin password | Firebase lockout, Cloudflare rate limiting, optional IP allow-list |
| Privilege escalation via role edit | `roles:*` restricted to Super Admin; last-super-admin invariant; every change audited |
| Enumerating other customers' orders | Ownership in the `WHERE` clause; 404 not 403; UUIDv7 ids |
| Session fixation via subdomain | `__Host-` cookie prefix |
| Replay of a captured request | Idempotency keys; TLS; short token lifetime |

## 10. Mobile readiness

The customer flow is already mobile-shaped: Firebase phone auth exists natively on Android
and iOS, the same `POST /v1/auth/session` call provisions the user, and the same bearer-token
pattern applies. The native apps will differ only in App Check provider (Play Integrity /
DeviceCheck) and in registering an FCM token via `POST /v1/me/devices`. No backend change is
required — see [30-API-MOBILE-APP-READINESS.md](30-API-MOBILE-APP-READINESS.md).
