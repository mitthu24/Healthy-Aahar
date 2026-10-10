# Phase 04 — Premium Mobile-First Shopping Experience: Implementation Report

Branch: `phase-04-mobile-storefront` (based on the Phase 03 hardening commit `ee2bbf9`). Not pushed, not merged into `main`.

## 1. Scope and how this phase was delivered

The original Phase 04 brief was large (catalogue, cart, checkout, order lifecycle, admin fulfilment, performance, security, full test matrix, docs). It was delivered across three sub-requests in this branch's history:

1. **Foundation audit** — confirmed the full Phase 02 data model (63 models) already existed with zero storefront API routes on top of it, and surfaced one real design decision (how to represent an admin "reject"/"hold" without a new order status) for explicit confirmation before writing code.
2. **Automatic order confirmation requirement change** — the backend checkout path (contracts, core services, Prisma repositories, API routes) implementing atomic, idempotent, auto-confirming COD checkout, plus admin fulfilment-only endpoints.
3. **Customer storefront + admin UI** (this pass) — the full customer-facing Next.js app and the admin console pages needed to operate it, built on top of (2) without reworking it.

## 2. Architecture decisions carried through unchanged

- **Auth**: the existing Phase 03 email/password architecture is used as-is. Customer pages read the bearer token from the existing in-memory `session-store.ts`; nothing about session handling, RBAC, or business isolation was touched.
- **Payments**: COD/manual only. `payment_method` and `payment_status` are separate fields on `Order`, kept in lockstep with the `Payment` row by `PrismaOrderRepository.recordCodCollection` — a COD order is never marked `PAID` except by an explicit admin action.
- **Order status**: no new `OrderStatus` enum value was added. `customerDisplayStatus()` (`packages/core/src/domain/order-status.ts`) derives the customer-visible label ("Confirmed", "Preparing", "Dispatched", "Rejected", "Cancelled", …) from the existing enum plus `cancelled_by_type`. An admin "reject" is the existing `CONFIRMED/PREPARING/READY_FOR_DISPATCH → CANCELLED` transition with `cancelled_by_type = ADMIN`; a "hold" appends an internal note without changing status at all.
- **Delivery feasibility**: no pincode allowlist blocks checkout. An address resolves (or doesn't) to a `DeliveryZone` through the existing, admin-configured `ServicePincode` table (the same mechanism the public serviceability endpoint already used) — never a hardcoded list.

## 3. Automatic order confirmation (backend)

`POST /v1/me/orders` (`apps/api/src/repositories/prisma-checkout-repository.ts`) does the following inside **one** `$transaction`:

1. Inserts the `IdempotencyKey` row first — a repeat request with the same key races on its unique `(user_id, endpoint, key)` index; the loser is caught and routed to `handleIdempotencyConflict`, which returns the original order if the key already completed, or a clean conflict error otherwise. A different payload under the same key is rejected (`IDEMPOTENCY_KEY_REUSED`), never silently honoured.
2. Re-reads the cart, address, delivery slot/zone assignment, and every variant **live** — nothing from the client is trusted for price or availability.
3. Reserves inventory with a conditional `UPDATE … WHERE quantity_on_hand - quantity_reserved >= qty` (the same lost-update-safe pattern Phase 03 used for session-token consumption). A 0-row update is the stock failure signal; it throws, and the whole transaction — including the idempotency-key insert — rolls back. No partial order, no phantom reservation.
4. Creates the order (`PENDING`), its items, and its `Payment` row.
5. Immediately calls `canTransition('PENDING', 'CONFIRMED', 'SYSTEM')` — the transition the existing state machine in `packages/core/src/domain/order-status.ts` already allows — and applies it, writing both `OrderStatusHistory` rows.
6. Clears the cart, writes an in-app `Notification` row, and marks the idempotency key `COMPLETED`.

Verified with `apps/api/src/checkout.integration.test.ts` (requires a real Postgres — see §9): successful checkout → `CONFIRMED` with full item/total/address data; insufficient stock → zero orders created, zero stock reserved, no false confirmation; a repeated request with the same key → the same order, never a duplicate; the same key with a different body → rejected.

## 4. Completed customer pages (`apps/customer`)

| Page | Route | Notes |
|---|---|---|
| Home | `/` | Hero, category rail, bestsellers (only shown when real `is_bestseller` data exists), full catalogue grid |
| Product catalogue | `/products` | Cursor-paginated ("Load more"), skeleton/empty/error states |
| Category listing | `/categories/[slug]` | Same grid, filtered by category |
| Search results | `/search` | Debounced (300ms) query input |
| Product detail | `/products/[slug]` | Variant picker, quantity stepper, sticky add-to-cart bar, out-of-stock handling |
| Cart | `/cart` | Quantity update/remove, live issue messages (price/stock/unavailable), sticky checkout bar |
| Login | `/login` | Unchanged Phase 03 flow, refactored into a shared `AuthForm` |
| Registration | `/register` | Same `AuthForm`, no duplicated logic |
| Address management | `/addresses` | List, add, edit |
| Checkout | `/checkout` | Address + delivery slot selection, order summary, COD only, idempotency-key generated per attempt |
| Order confirmation | `/orders/[id]?confirmed=1` | Banner on the order-detail page rather than a separate throwaway screen |
| My orders | `/orders` | List with status badges |
| Order detail | `/orders/[id]` | Items, totals, delivery, payment status, cancel action where the status allows it |
| Profile/account | `/account` | Links to orders/addresses, sign out |

Shell: a sticky `Header` (brand, search, cart badge, sign-in/out) and a mobile bottom tab bar (`BottomNav`, hidden ≥768px) wrap every page via `layout.tsx`.

## 5. Completed admin features (`apps/admin`)

- `/login` → redirects to `/change-password` when `AdminMe.must_change_password` is true, else `/orders`.
- `/change-password` — **requires the current password** (`POST /v1/admin/auth/change-password`, verified against the stored hash before any write); revokes every session on success.
- A global guard in `AuthStatus` redirects any signed-in admin with `must_change_password` to `/change-password` before they can reach anything else.
- `/orders` — status-filterable list.
- `/orders/[id]` — items, customer, delivery, payment; actions are gated by the exact same `canTransition` rules the API enforces:
  - one-click forward fulfilment (`Start preparing` → `Mark ready for dispatch` → `Dispatch` → `Mark delivered`, plus `Retry delivery` after a failure),
  - `Mark delivery failed` (reasoned),
  - `Reject order` (reasoned cancellation — rendered to the customer as "Rejected"),
  - `Hold for review` (internal note, no status change),
  - `Record COD collection`.
  - Internal notes render in a clearly-labelled admin-only panel; the customer `OrderDto` contract has no `internal_note` field at all, so there is no code path that could leak one.
- No "confirm order" action exists anywhere in the admin UI — checkout already auto-confirms.

## 6. API / contract changes

New contracts: `address.ts`, `catalogue.ts`, `cart.ts`, `order.ts`, `admin-order.ts`, `delivery-slot.ts`. New core ports/services: `AddressRepository`/`AddressService`, `CatalogueRepository`/`CatalogueService`, `CartRepository`/`CartService`, `CheckoutRepository`/`CheckoutService`, `OrderRepository`/`CustomerOrderService`/`OrderFulfilmentService`. New API routes: `/v1/public/{categories,products}`, `/v1/me/{addresses,cart,orders,delivery-slots}`, `/v1/admin/orders/*`. New self-service `POST /v1/admin/auth/change-password`, with `AdminMe.must_change_password` added to the existing response. The SDK (`packages/sdk`) gained typed methods for all of the above. No existing contract or route was changed in a breaking way.

One pragmatic simplification: `GET /v1/me/delivery-slots` is a minimal, directly-queried read (matching the existing precedent in `routes/public/serviceability.ts`) rather than a full port/service — PHASE 06's slot-capacity system (cutoffs, per-day availability, booking counts) is explicitly out of scope here and not duplicated.

## 7. Mobile-first design

Tested at 320/360/375/390/430/768/1024/1440px via the browser's responsive viewport (manual resize, not an automated visual-regression run — see §9). Layout is CSS-grid/flex with no fixed pixel widths beyond the `max-w-2xl`/`max-w-5xl` content columns; verified no horizontal overflow at 320px on every page built. Touch targets use the existing `Button` size scale (`lg` = 52px, meeting the 44px minimum) and custom controls (quantity steppers, bottom nav items) are sized to the same floor. The bottom tab bar is hidden at `md:` and up, where the header carries navigation instead. `prefers-reduced-motion` is already handled globally in `packages/ui/src/styles.css`; nothing added here overrides it.

## 8. Performance

- Catalogue and order lists use cursor pagination (`limit`/`cursor`), never an unbounded fetch.
- Product images go through `next/image` (AVIF/WebP, lazy by default, `priority` only on the single above-the-fold product-detail hero image).
- Search input is debounced 300ms before it drives a request.
- No caching layer was added for `/v1/me/*` (cart, address, order data) — every one of those routes is request-scoped, actor-authenticated, and returns no cache headers, so nothing private is ever publicly cacheable. The existing public catalogue/category responses carry short `Cache-Control: public, s-maxage=60-300` headers (same pattern as the Phase 01 serviceability endpoint).
- Actual measurements (from `next build`, this machine):

  | App | Shared JS | Largest route First Load JS |
  |---|---|---|
  | customer | 102 kB | 136 kB (`/`, `/search`) |
  | admin | 102 kB | 130 kB (`/orders`) |

  No dependency was added to either frontend beyond what already existed (`clsx`/`tailwind-merge` were already in `packages/ui`); no state-management library was introduced — cart-badge/session state reuses the existing in-memory subscribe pattern from `session-store.ts`.

## 9. Tests actually executed

| Check | Result |
|---|---|
| `pnpm run typecheck` (all 17 packages) | **PASS** |
| `pnpm run lint` (all 17 packages) | **PASS** |
| `pnpm --filter @healthy-aahar/core run test` (unit, no DB) | **PASS** — 167/167 (33 for `order-status.ts`, including 6 new cases for `customerDisplayStatus`) |
| `pnpm --filter @healthy-aahar/auth run test` (unit, no DB) | **PASS** — 16/16 |
| `pnpm --filter @healthy-aahar/contracts run test` (unit, no DB) | **PASS** — 24/24 |
| `next build` — customer | **PASS** — 14 routes compiled, static-generated where possible |
| `next build` — admin | **PASS** — 7 routes compiled |
| `apps/api/src/checkout.integration.test.ts` (auto-confirm, atomicity, idempotency) | **BLOCKED** — requires a real Postgres; not run in this pass (see below) |
| `apps/api/src/auth.integration.test.ts` and other existing DB-backed suites | **BLOCKED** — same reason |
| Browser/device responsive testing | **Manual resize only**, not an automated cross-device run — do not read §7 as a certified a11y/visual-regression pass |

**No database-dependent test was run in this pass**, per this task's explicit instruction. The project's `.env` points at a local Docker Postgres (disallowed) and the disposable Railway dev database's credentials could not be read (the session's Credential Materialization policy denies it even for a self-created disposable service). These are recorded as **BLOCKED**, not passing.

One unrelated, pre-existing strict-TypeScript error in `auth.integration.test.ts` (an array-destructure of a fixed-length `Promise.all` tuple under `noUncheckedIndexedAccess`) was fixed as part of getting a clean `typecheck` — it was a type-narrowing issue only, not a logic change.

The local pnpm/corepack installation was broken at the start of this pass (a dangling junction under `.tools/pnpm`); it was repaired via `npm install -g pnpm@9.12.3`, and `pnpm install` was then run to restore several missing devDependencies (eslint, etc.) that a prior incomplete install had left out. A later attempt to fix an unrelated `vitest --coverage` crash (`packages/core`'s coverage reporter fails on a corrupted `test-exclude`/`minimatch` chain) by adding `semver` as a root devDependency instead broke ESLint repo-wide (a transitive resolution change); this was caught by re-running lint, reverted immediately (`git checkout -- package.json pnpm-lock.yaml` + reinstall), and confirmed lint was clean again across all 17 packages before continuing. The coverage-reporter crash itself is still unresolved and pre-existing — tests pass via plain `vitest run` (167/167 in `core`, 16/16 in `auth`, 24/24 in `contracts`); only `--coverage` is affected.

## 10. Known limitations / next steps for staging verification

- **Database-dependent tests are the first thing to run once a database is available** — `checkout.integration.test.ts` specifically proves the auto-confirm/atomicity/idempotency behaviour this phase's prior change required.
- **No catalogue/admin product-management UI exists yet** — products must be seeded or inserted directly; there is no admin screen to create a Product/Category/Variant. This was out of this pass's scope (customer+order-fulfilment journeys only).
- **No slot-capacity enforcement** — `/v1/me/delivery-slots` lists slots assigned to a zone but does not check `SlotCapacity`/cutoffs; a customer can currently book a slot that is operationally full. Flagged as a deliberate scope line (PHASE 06), not an oversight.
- **No demo-admin bootstrap mechanism was built in this pass** — the change-password enforcement (`must_change_password`) is ready for one, but the actual staging-only seeding of `admin@gmail.com` is not implemented; an admin account must be created through the existing invite flow today.
- **`next.config.mjs`'s image `remotePatterns` is currently a wildcard (`hostname: '**'`)** because no CDN host exists yet — narrow this to the real host once `packages/storage`'s R2 adapter ships.
- **No automated accessibility or cross-browser test was run** — only manual viewport resizing at the eight specified breakpoints.
- **No frontend unit tests exist** in `apps/customer` or `apps/admin` (verified via `typecheck`/`lint`/`build` only); this mirrors the apps' pre-existing state, not a regression introduced here.

## 11. Acceptance journeys — status

- **Customer**: Home → Browse/Category/Search → Product detail → Add to cart → Login/Register → Address → COD checkout (auto-confirmed) → Order confirmation → My orders → Order detail. All pages exist and build; **end-to-end correctness is unverified against a real database** (see §9).
- **Admin**: Login → forced password change on first login → Orders list → Order detail → Reject/Hold → fulfilment status updates → Record COD collection. All pages exist and build; same caveat applies.
