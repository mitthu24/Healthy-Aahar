# 30 — Mobile App Readiness

The native Android and iOS apps are Phase 6. This document states what the MVP must get
right so that building them requires **no backend changes**, and how to verify that claim
before it is too late to fix.

## 1. The claim

> When the mobile apps are built, they will consume `api.maindomain.com/v1` exactly as the
> web apps do, with no new endpoints, no parallel API, and no changes to business logic.

Everything below is either an enabler of that claim or a test of it.

## 2. What the MVP already does right

| Requirement | How it is satisfied |
|---|---|
| A stable, frontend-independent base URL | `api.maindomain.com` is its own origin on its own service (ADR-002) |
| No business logic in the web tier | All logic in `packages/core`, behind HTTP (doc 02 §4) |
| Stateless authentication | Firebase ID tokens as bearer tokens — the same pattern native SDKs use (doc 07 §4.3) |
| Documented contract | OpenAPI 3.1 generated from Zod, served at `/v1/openapi.json` |
| Versioned API | `/v1` prefix; breaking changes require a new version (doc 06 §14) |
| No cookies required | The customer API is cookie-free; only the admin panel uses a session cookie |
| CORS irrelevant to native | Native clients send no `Origin`; nothing to configure |
| Consistent errors | Stable `code` values that clients branch on, never `message` strings |
| Idempotency | `Idempotency-Key` — essential on mobile networks that drop and retry |
| Cursor pagination | Stable under concurrent writes; the right model for infinite scroll |
| Push-ready | `POST /v1/me/devices` specified; `notification_logs.channel` includes `PUSH` |
| Client identification | `X-Client` header enables minimum-version gating |
| Money as a structured object | No locale formatting or float arithmetic on the device |
| Absolute timestamps | `cutoff_at` in UTC; the server also supplies pre-formatted IST labels |

## 3. Why not tRPC, GraphQL or Next.js route handlers

Each was considered and rejected specifically because of this requirement:

- **tRPC** gives superb TypeScript DX but is an RPC protocol tied to a TypeScript client.
  Kotlin and Swift clients would need a bespoke client or a parallel REST layer — precisely
  the outcome to avoid.
- **GraphQL** would work, but it adds a schema language, a caching model and N+1 risk for a
  small, stable surface, and REST + OpenAPI generates better native clients today.
- **Next.js route handlers** would give the mobile app a *frontend* base URL, coupling
  every mobile release to a web deployment, plus serverless cold starts on checkout.

## 4. Generated clients

The same OpenAPI document generates:

| Platform | Generator | Output |
|---|---|---|
| Web (now) | `openapi-typescript` + typed fetch | `packages/sdk` |
| Android (P6) | OpenAPI Generator `kotlin` | Retrofit + kotlinx.serialization |
| iOS (P6) | OpenAPI Generator `swift5` | URLSession + Codable |

Because the document is generated from the Zod schemas the API validates with, it cannot
drift from the implementation. Client generation is therefore mechanical, and a breaking API
change fails CI rather than a shipped app.

## 5. Contract stability rules

These rules exist because a web client is updated by refreshing the page, while a native
client may be six months out of date on a device we cannot reach.

**Non-breaking** (allowed at any time):
- Adding an optional request field.
- Adding a response field — **clients must ignore unknown fields**, and this is stated in the
  SDK contract.
- Adding an endpoint.
- Adding an enum value **that clients treat as unknown gracefully** (clients must have a
  default branch; the OpenAPI enums are documented as open).
- Relaxing a validation rule.

**Breaking** (requires `/v2`):
- Removing or renaming any field.
- Changing a field's type or making an optional field required.
- Changing an error `code` value.
- Changing authentication or authorization semantics.
- Removing an endpoint.

**Enforcement:** CI runs an OpenAPI diff against `main` and fails on a breaking change
without a version bump. Deprecations emit `Deprecation` and `Sunset` headers for at least 90
days before removal.

## 6. Version gating

Every client sends `X-Client: android/2.0.0`. The API compares against a minimum supported
version held in `settings`, and returns `426 CLIENT_UPGRADE_REQUIRED` with a store URL when a
build is too old to behave correctly. This is the escape hatch for a genuine forced upgrade —
and it only works because the header is collected from day one, which costs nothing now and
is impossible to retrofit onto already-shipped apps.

## 7. Mobile-specific work in Phase 6

None of this touches the backend's business logic:

| Work | Backend impact |
|---|---|
| Firebase phone auth natively | None — same `POST /v1/auth/session` |
| App Check with Play Integrity / DeviceCheck | Configuration in the Firebase console |
| FCM / APNs token registration | `POST /v1/me/devices` — specified, implemented in P3 with web push |
| Push notification delivery | A new `NotificationChannel` adapter (doc 18 §3) |
| Deep links (`healthly://products/{slug}`) | Universal Links / App Links files served by the marketing app |
| Offline catalogue cache | Client-side; the API already sends ETags |
| Store compliance (privacy labels, data-deletion route) | The erasure endpoint from P2 satisfies both stores' requirements |

## 8. Design system reuse

`packages/config/tokens/*.json` is deliberately plain JSON, not Tailwind config
(doc 17 §10). React Native or Jetpack Compose consumes the same colour, spacing, radius and
typography tokens, so the apps look like the web product without a second design system.
Component code is not shared — a React Native rewrite of the UI layer is expected and
appropriate.

## 9. Which framework (decide at Phase 6)

| Option | For | Against |
|---|---|---|
| **React Native / Expo** (likely) | Shares TypeScript, types from `packages/contracts`, and the token set; one team; fast iteration | Larger binary; native modules occasionally needed |
| Native Kotlin + Swift | Best performance and platform feel | Two codebases, two skillsets, slowest to ship |
| Flutter | Excellent UI performance | Dart; no reuse of our existing TypeScript contracts |

**Provisional:** Expo, precisely because `packages/contracts` and the generated SDK are
reusable verbatim. Recorded as `PENDING` in doc 36 — the decision belongs at Phase 6, when
team composition is known.

## 10. Verifying the claim early

The claim in §1 is cheap to make and expensive to discover is false. It is therefore tested
continuously, starting in Phase 2:

1. **Every feature is built API-first.** The endpoint and its tests exist and pass before any
   UI is written.
2. **An integration test suite hits the API with no browser context** — no cookies, no
   `Origin` header, bearer token only. This is exactly a mobile client, and it runs on every
   PR. If a feature only works from a browser, this suite fails immediately rather than in
   Phase 6.
3. **CI generates a Kotlin client from the OpenAPI document** from Phase 3 onward and fails
   if generation errors. It is never used in production; it proves the document is
   well-formed and complete.
4. **A checklist item in every API PR:** "could a native client call this?"

The point is to make the mobile readiness claim falsifiable today rather than aspirational
until Phase 6.
