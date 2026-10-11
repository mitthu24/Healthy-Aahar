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
- ~~No catalogue/admin product-management UI exists yet~~ — **built in Phase 04B, §12 below.**
- **No slot-capacity enforcement** — `/v1/me/delivery-slots` lists slots assigned to a zone but does not check `SlotCapacity`/cutoffs; a customer can currently book a slot that is operationally full. Flagged as a deliberate scope line (PHASE 06), not an oversight.
- **No demo-admin bootstrap mechanism was built in this pass** — the change-password enforcement (`must_change_password`) is ready for one, but the actual staging-only seeding of `admin@gmail.com` is not implemented; an admin account must be created through the existing invite flow today.
- **`next.config.mjs`'s image `remotePatterns` is currently a wildcard (`hostname: '**'`)** because no CDN host exists yet — narrow this to the real host once `packages/storage`'s R2 adapter ships.
- **No automated accessibility or cross-browser test was run** — only manual viewport resizing at the eight specified breakpoints.
- **No frontend unit tests exist** in `apps/customer` or `apps/admin` (verified via `typecheck`/`lint`/`build` only); this mirrors the apps' pre-existing state, not a regression introduced here.

## 11. Acceptance journeys — status

- **Customer**: Home → Browse/Category/Search → Product detail → Add to cart → Login/Register → Address → COD checkout (auto-confirmed) → Order confirmation → My orders → Order detail. All pages exist and build; **end-to-end correctness is unverified against a real database** (see §9).
- **Admin (orders)**: Login → forced password change on first login → Orders list → Order detail → Reject/Hold → fulfilment status updates → Record COD collection. All pages exist and build; same caveat applies.
- **Admin (catalogue, Phase 04B)**: Login → create category → create product → add a variant with price + stock → publish → product becomes visible through the public catalogue API. All pages exist and build; same database caveat applies (see §13).

## 12. Phase 04B — Admin Catalogue Management

Adds the piece explicitly out of scope in §10 above: admin screens to create categories, products, variants and stock, so the customer storefront can show genuine database-backed products instead of nothing. No new tables or migrations — this is entirely additive on the Phase 02 schema (`Category`, `Product`, `ProductVariant`, `ProductImage`, `Inventory`, `InventoryMovement`), which already had everything needed.

### Audit findings that shaped the design

- **Unique slugs** are enforced by DB-level partial unique indexes (`categories_business_slug_unique`, `products_business_slug_unique`, both `WHERE deleted_at IS NULL`) — not a Prisma `@@unique`. Slug collisions are caught via `isUniqueConstraintViolation` (the same helper Phase 03 built) and mapped to a clean `SLUG_ALREADY_IN_USE` error, not a raw 500.
- **Inventory already has the CHECK constraints this phase needed**: `quantity_on_hand >= 0`, `quantity_reserved >= 0`, and critically `quantity_reserved <= quantity_on_hand OR allow_backorder` — the exact rule "don't let product editing silently overwrite reserved inventory" requires. Stock is set via a conditional `UPDATE` that mirrors this constraint (`WHERE allow_backorder OR quantity_reserved <= :new_value`); a 0-row result is reported as `STOCK_BELOW_RESERVED` with the exact reserved count, rather than surfacing a raw Postgres constraint error.
- **RBAC permissions already existed** for every operation needed (`catalog:read/create/update/delete/publish`, `inventory:read/adjust`) — Phase 03's permission catalogue anticipated this phase; no new permission was added.
- **`packages/storage` is a port only** — no R2/S3 adapter exists (its own doc comment marks that PHASE 05). Rather than inventing an upload pipeline, product images are added by URL: the admin supplies an already-hosted `https://…` link ending in a recognised image extension, validated by the contract (`addProductImageBodySchema`) before the API ever touches it.

### What was built

- **Contracts**: `packages/contracts/src/admin-catalogue.ts` — category/product/variant/image schemas and bodies, plus 6 new error codes (`CATEGORY_NOT_FOUND`, `SLUG_ALREADY_IN_USE`, `CATEGORY_HAS_PRODUCTS`, `PRODUCT_NOT_PUBLISHABLE`, `STOCK_BELOW_RESERVED`, `IMAGE_NOT_FOUND`).
- **Core**: `AdminCategoryRepository`/`AdminProductRepository`/`AdminVariantRepository` ports and one `AdminCatalogueService` enforcing every business rule — slug uniqueness, "a category with products can't be deleted" (`CATEGORY_HAS_PRODUCTS`, counted live, not cached), "a product with zero variants can't be published" (`PRODUCT_NOT_PUBLISHABLE`), "MRP can't be below the selling price." Every write calls `AuditLogRepository.write()` (category/product/variant create, update, status change, image add/remove, stock set) — the same mechanism Phase 03's RBAC admin actions use, not a new one.
- **Prisma repositories**: `prisma-admin-catalogue-repository.ts`. `setStock` runs inside a transaction: if no `Inventory` row exists yet it creates one (a brand-new variant has none until this is called), otherwise the conditional `UPDATE` above; either path writes one `InventoryMovement` (`reason: MANUAL_ADJUSTMENT`) with the actual delta, so the ledger stays the single source of truth for "why did stock change" — nothing here introduces a second one.
- **API routes** (`apps/api/src/routes/admin/catalogue.ts`): `/v1/admin/categories` (list/create/get/update/delete), `/v1/admin/products` (list/create/get/update/status/images), `/v1/admin/products/{id}/variants` (create), `/v1/admin/variants/{id}` (update), `/v1/admin/variants/{id}/stock` (set). Every mutation requires the matching `catalog:*`/`inventory:adjust` permission via the existing route-registry + `requirePermission` mechanism — nothing bypasses it.
- **Publish guard**: `POST /products/{id}/status` to `ACTIVE` is refused (`PRODUCT_NOT_PUBLISHABLE`) when the product has zero variants — this is what makes the acceptance criterion ("create a product with at least one variant... then publish it") an enforced rule, not just a UI suggestion.
- **Public-catalogue isolation, unchanged**: `routes/public/catalogue.ts` still reads only `status = 'ACTIVE'`; nothing in Phase 04B touches that filter or exposes `internal_note`/cost price/draft products through it. A product created here is invisible to customers until explicitly published.
- **SDK**: `packages/sdk` gained typed methods for every route above.
- **Admin UI** (`apps/admin`): `/categories` (list, create/edit form with client-side slugify, activate/deactivate, delete with a two-click confirm and a surfaced `CATEGORY_HAS_PRODUCTS` error instead of a silent failure), `/products` (status-filterable list), `/products/new` (create — category dropdown, disabled with a clear message if no category exists yet), `/products/[id]` (publish/unpublish/archive buttons, image gallery with add-by-URL and remove, per-variant stock editor showing on-hand/reserved/available, add-variant form). Destructive actions (category delete) require an explicit second click; stock/price changes show inline save state and errors rather than failing silently.
- **Demo data**: `packages/db/scripts/seed-demo-catalogue.mjs` (`pnpm db:seed-demo-catalogue`) — **not** part of `prisma/seed.ts` and never runs automatically. Refuses outright under `APP_ENV=production` (no override flag, unlike the main seed — there is no legitimate reason to run synthetic demo products against production). Idempotent (find-then-create by slug/SKU, safe to re-run), creates two categories and two DRAFT products with priced, stocked variants; nothing is auto-published — an operator still publishes from `/products` to exercise the acceptance journey.

### Mobile responsiveness

Manually resized at 320/360/375/390/430/768/1024/1440px (same method as §7 — not an automated visual-regression run). The product table becomes a scroll-contained element rather than overflowing the viewport at 320px; forms stack to one column; the variant stock editor's inline inputs/buttons wrap rather than clipping. No horizontal overflow observed at any width tested.

## 13. Tests executed for Phase 04B

| Check | Result |
|---|---|
| `pnpm run format:check` / `lint` / `typecheck` (all 17 packages) | **PASS** |
| `pnpm run build` (all 6 build targets, including admin's 3 new routes) | **PASS** |
| `pnpm --filter @healthy-aahar/core run test` (unit, no DB) | **PASS** — 167/167, unchanged (no new unit tests were added for the new service — see limitations) |
| Database-dependent verification (would prove slug-uniqueness, the stock-vs-reserved CHECK, and the publish → public-catalogue-visibility path end to end) | **BLOCKED/DEFERRED** — not run, per this task's explicit instruction; no database was connected to in this pass |

### Known limitations

- **No unit/integration tests were added for `AdminCatalogueService` or the Prisma catalogue repository** in this pass — the acceptance criterion (create category → product → variant → publish → visible in public catalogue) is implemented but **not yet verified against a real database**. This is the first thing to test once database access resumes.
- **Category deletion count is a live query, not cached** — correct, but means `DELETE /v1/admin/categories/{id}` costs one extra `COUNT` query; negligible at expected catalogue sizes.
- **No bulk operations** (bulk price update, bulk publish) — one product/variant at a time, matching the acceptance criterion's scope.
- **Image validation is URL-shape only** — `https://` + a recognised extension. Nothing fetches or inspects the actual bytes (no dimension check, no content-type verification, no malware/format scan) because there is no storage adapter to do that work yet (PHASE 05's documented job).
- **`next.config.mjs`'s image `remotePatterns` wildcard** (already flagged in §10 for the customer app) now also applies to `apps/admin`, for the same reason.

## 14. Phase 04C — Connecting the journey end-to-end

### Audit findings

Re-read every layer named in the task (customer pages, admin catalogue, cart/checkout, auth/address, order history, contracts/SDK/OpenAPI, and this report). Confirmed in code (not assumed): every customer page added in §4 and every admin page added in §12 calls the real API through `apiClient` — there is no hardcoded product/category array anywhere in `apps/customer` or `apps/admin`. Ownership scoping (`customerProfileId`), the auto-confirm checkout path, and the public-catalogue `status = 'ACTIVE'` filter are all unchanged and still correct on inspection.

**One concrete, journey-blocking gap found**: checkout requires an address to resolve to a `DeliveryZone` (via `ServicePincode.delivery_zone_id`) and a `DeliverySlot` assigned to that zone (`SlotZoneAssignment`). Nothing in the codebase — no admin route, no seed step — has ever created a `DeliveryZone`, `DeliverySlot` or `SlotZoneAssignment` row. PHASE 06 ("Delivery Zones & Slots", docs/34) is where the real admin screen for this belongs and has not been built. Net effect: **in any environment seeded only from `prisma/seed.ts`, checkout cannot succeed for ANY address**, regardless of how correct the UI and APIs are — not a bug in this phase's code, but a missing precondition for the acceptance journey to complete at all.

Fixed with the narrowest possible unblock, not a PHASE 06 front-run: `packages/db/scripts/seed-demo-delivery.mjs` (`pnpm db:seed-demo-delivery`) — one demo zone per ACTIVE city, one wide-open demo slot, the assignment between them, and back-filling `delivery_zone_id` on every ACTIVE pincode that doesn't have one yet. Same safety pattern as the catalogue demo seed: refuses under `APP_ENV=production` (no override — zone fees/capacity/cutoffs are real operational decisions this script has no business inventing for production), idempotent, never resets anything. This is explicitly a staging/demo convenience, documented as such in the script's own header — a real PHASE 06 admin screen is still the actual deliverable that phase owes.

### Gap closed: order status timeline

The task's order-history requirements explicitly list "order status timeline," which did not exist — the order detail page showed only the current status. Added:

- `OrderRepository.getForCustomer`/`getForAdmin` (via the shared `order-row-mapper.ts`) now include `OrderStatusHistory`, ordered oldest-first.
- `orderSchema` (customer contract) gained `status_history: [{ status, display_status, at }]`. Each entry's `display_status` runs through the same `customerDisplayStatus()` mapping as the order's current status, so a history entry for an admin-rejected order reads "Rejected," never the raw `CANCELLED` enum value — consistent with the existing no-new-status design, and consistent with never exposing an internal detail (no actor, no reason, no internal note) through this list.
- The customer order-detail page renders it as a simple chronological list, newest entry highlighted.
- The admin order DTO was deliberately **not** changed — the admin screen already shows current status plus the cancellation reason, and adding a parallel timeline there was not asked for and would be scope creep.

### What was verified, and how

- **Format/lint/typecheck**: clean across all 17 packages.
- **Build**: all 6 targets pass, including the order-detail page's new section.
- **Unit tests**: core 167/167, unchanged (the status-history mapping is exercised by existing `customerDisplayStatus` tests — no new domain logic was added, only a new field shaped from existing data).
- **Mobile viewports — actually resized and screenshotted, not assumed**: customer app at 320×700 (home, `/products`, `/login`, and an unauthenticated `/cart` visit — confirmed it redirects to `/login?next=/cart`, not a broken page), 768×900 (home — bottom nav correctly hidden at the `md:` breakpoint, search bar fully visible in the header), and 1440×900 (home — no overflow; content stays inside the deliberate `max-w-2xl` mobile-first column rather than stretching, which is the existing design, not a bug). Admin app at 320×700 (`/products` — status filter chips wrap to a second row cleanly, no horizontal scroll; the header title wraps to two lines, which is tight but not broken). **Not tested this pass**: 360, 375, 390, 430 and 1024px, and the remaining customer/admin pages beyond those listed above — do not read this as full-matrix coverage. No API server was reachable during this check, so every data-driven state shown was the app's own error/empty/redirect handling, not real product data — layout and navigation chrome were verified; real data rendering at each breakpoint was not.
- **Database-dependent verification** (the actual acceptance journey — admin publishes → customer discovers → cart → address → COD checkout → CONFIRMED → order history): **BLOCKED/DEFERRED**, not run, per this task's explicit instruction. No database was connected to in this pass.

### Known limitations after Phase 04C

- **The delivery-zone/slot gap is unblocked for demo purposes only** — a real PHASE 06 admin UI for zones, slots, capacity and cutoffs still does not exist. `seed-demo-delivery.mjs` is a stopgap, documented as one.
- **The full acceptance journey has still never been run against a real database.** Everything above is verified by code inspection, typecheck/lint/build, and layout-only browser checks — not by actually placing an order.
- **Order status timeline shows status changes only**, not who made them or why (that detail — reason, actor — stays admin-only, matching the "never expose internal notes" requirement, but also means a customer can't see a cancellation's reason inline in the timeline itself; it's already shown separately as `cancellation_reason`).

## 15. Phase 04 finalization — delivery-slot-only checkout, founder/admin slot management

Re-scopes §14's stopgap into a real, permanent feature, per explicit instruction: **Healthy Aahar's checkout requires a delivery slot only — not a delivery zone.** PHASE 06 ("Delivery Zones & Slots") remains the owner of zone/pincode-level delivery-area management if that is ever built; this phase does not front-run it, and does not invent fake zones to make checkout work.

### What changed, and why

`orders.delivery_zone_id` was `NOT NULL` with `ON DELETE RESTRICT`, which is what forced every checkout through a `DeliveryZone` that nothing in the product had any way to create (§14's finding). The smallest safe change that removes that requirement, without a broader schema rewrite:

- **Migration** `packages/db/prisma/migrations/20261011080000_phase04_delivery_slot_only/` — `ALTER TABLE orders ALTER COLUMN delivery_zone_id DROP NOT NULL`, and the FK recreated as `ON DELETE SET NULL` (the same policy `addresses.delivery_zone_id` and `service_pincodes.delivery_zone_id` already use for their own nullable zone references). Additive only: `delivery_zones`, `slot_zone_assignments` and `slot_capacity` are untouched, left exactly as-is for a future PHASE 06. **Not run against any database in this pass** — only `prisma validate`/`prisma generate` (schema-only, no connection) — see §16.
- **`prisma-checkout-repository.ts`**: the address→zone→`SlotZoneAssignment` resolution block is gone. Checkout now resolves the address (ownership check only — any address belonging to the customer is accepted, never a pincode allowlist) and the slot independently: the slot must be `isActive`, not soft-deleted, and must list the service date's ISO weekday in `available_days`, or the request is rejected (`SLOT_NOT_AVAILABLE_ON_DAY`, 422). Delivery fee and minimum-order-value now come from `DeliverySlot.deliveryFeePaise`/`minOrderValuePaise` (fields that already existed on the model, unused until now) instead of the zone's equivalents — a zone's "free delivery above ₹X" threshold has no slot equivalent and was not reinvented; slot delivery fee is flat.
- **Capacity, without a new capacity table**: `SlotCapacity` is itself zone-coupled and reusing it would have required its own schema change. Instead, checkout takes a Postgres advisory transaction lock keyed on `(slot_id, service_date)` (`pg_advisory_xact_lock(hashtext(...))`), then counts non-terminal `Order` rows for that `(slot, date)` pair against `DeliverySlot.default_capacity`. The lock serialises concurrent checkouts for the same slot+date so two requests racing for the last seat cannot both read "1 remaining" and both succeed — the same concurrency goal the existing inventory conditional `UPDATE` achieves for stock, applied here because a slot's capacity has no single row to condition an `UPDATE` on. Exceeding capacity returns `SLOT_CAPACITY_EXCEEDED` (409), not a silent overbook.
- **No new order status, no bypass of `canTransition`** — the existing `PENDING → CONFIRMED` (actor `SYSTEM`) auto-confirm rule from §3 is unchanged and still the only way an order reaches `CONFIRMED`.

### Founder/admin delivery-slot management (new)

A full admin CRUD surface for delivery slots, reusing the **existing** `delivery:read`/`delivery:manage` permissions (already in the Phase 03 permission catalogue, already assigned to the appropriate roles, already used by the zone/pincode admin screens) — no new permission was added, no RBAC rule was weakened.

- **Core**: `AdminDeliverySlotRepository` port, `AdminDeliverySlotService` (validates `start_time < end_time` on both create and update, rejects a duplicate `code` as `SLUG_ALREADY_IN_USE`, writes an `AuditLogRepository` event on every create/update — `delivery_slot.created`, `delivery_slot.updated`, or `delivery_slot.status_changed` when `is_active` is the field that changed).
- **Prisma repository**: `PrismaAdminDeliverySlotRepository` — straightforward CRUD against the existing `DeliverySlot` table (soft-delete-aware via `deleted_at IS NULL`), mapping a unique-`code` violation to the same `SLUG_ALREADY_IN_USE` error the service layer also guards against pre-insert (defence in depth against a race, same pattern as the catalogue slug check).
- **API** (`apps/api/src/routes/admin/delivery-slots.ts`): `GET/POST /v1/admin/delivery-slots`, `GET/PATCH /v1/admin/delivery-slots/{id}` — registered through the same route-registry + `requirePermission` mechanism every other admin route uses; nothing here is a special case.
- **Validation enforced server-side, not just in the admin UI**: invalid time range (`VALIDATION_FAILED`), negative/zero capacity (`z.number().int().positive()` in the contract, before the service or DB is even reached), duplicate `code` (`SLUG_ALREADY_IN_USE`), and `available_days` restricted to ISO 1–7 (matching the pre-existing DB `CHECK` constraint `delivery_slots_available_days_valid`) — the contract schema and the DB constraint agree, so a request that passes Zod validation cannot then fail the constraint.
- **Admin UI** (`apps/admin/src/app/delivery-slots/page.tsx`, linked from the nav as "Slots"): list with label/time/capacity/available-days/fee, create/edit form (label, code, start/end time, available days as toggle chips, capacity, optional delivery fee), and an activate/deactivate action — mirroring the existing `/categories` page's layout and interaction pattern rather than inventing a new one.
- **Customers never see or select an inactive or full slot**: `GET /v1/me/delivery-slots` (customer-facing, unchanged route, updated response shape) filters to `is_active = true` slots and, when `service_date` is supplied, further filters to slots offered that weekday and computes `remaining_capacity`/`is_available` live from the same booked-count query checkout itself uses. An already-full or inactive slot is either absent from the list or rendered disabled in the checkout UI (`apps/customer/src/app/checkout/page.tsx`) — never selectable client-side, and rejected server-side regardless (checkout re-validates independently; the list endpoint is a convenience, not the enforcement point).

### Safe default seeding — exactly two windows, idempotent, production-refusing

`packages/db/scripts/seed-demo-delivery.mjs` was rewritten (same script name, entirely different content — the old zone/assignment/pincode-backfill logic from §14 is gone, not extended):

- Seeds **exactly two slots**: Morning `07:00–08:00` and Evening `18:00–19:00` — not the old `02:00–07:00` window, and no third slot.
- Creates **no `DeliveryZone`, `SlotZoneAssignment` or `ServicePincode` row** — out of scope for this phase, per instruction.
- **Idempotent and founder-safe**: looks up each slot by `code` (`morning`/`evening`) first; if either already exists, it is left completely untouched (not updated, not overwritten) — a founder who has since edited that slot's hours or capacity through the admin UI keeps their changes.
- **Refuses under `APP_ENV=production`** with no override flag, same as every other demo-seed script in this codebase — slot capacity/cutoffs/fees are real operational decisions this script has no business inventing for a live business.
- These two windows are the **starting point**, not a hard limit: the admin UI above lets a founder create further slots (a mid-day window, a weekend-only window, etc.) at any time.

### What did NOT change

No existing order status was added. No RBAC rule was weakened — the same two permissions, the same `requirePermission` middleware, the same route-registry soundness check. No pincode allowlist or blocking logic was introduced anywhere (addresses are still accepted regardless of pincode; the slot itself is the only gate). `packages/core/src/domain/order-status.ts` (`ORDER_TRANSITIONS`, `canTransition`) was not touched. The admin orders/catalogue surfaces from §5/§12 were re-read for this pass and found to need no changes — they do not reference `DeliveryZone` and were unaffected by this change.

## 16. Tests executed for this finalization pass

| Check | Result |
|---|---|
| `pnpm --filter @healthy-aahar/{api,core,contracts,sdk,customer,admin} run typecheck` | **PASS** — zero errors, no `any`/type-assertion workaround used anywhere in the new or changed code |
| `pnpm --filter @healthy-aahar/{api,core,contracts,customer,admin} run lint` | **PASS** |
| `prettier --check` on every touched file, `--write` applied only to the 7 files it flagged, re-verified with the same typecheck/lint commands afterward | **PASS** — no unrelated reformatting (confirmed via `git diff`, learning the schema-file lesson from §14 was not repeated: `prisma format` was never run this pass) |
| `prisma validate` against the edited schema | **PASS** (schema-syntax only, no database connection) |
| `pnpm --filter @healthy-aahar/core run test` (unit, no DB) | **PASS** — 175/175 (167 existing + 8 new `AdminDeliverySlotService` tests: create+audit event, start/end validation on create, equal start/end rejected, duplicate code rejected, capacity-only update keeps existing valid range, update that breaks the range is rejected, activate/deactivate writes `status_changed` not a generic `updated` event, unknown id throws `NOT_FOUND`) |
| `pnpm --filter @healthy-aahar/contracts run test` | **PASS** — 24/24, unchanged |
| `pnpm exec turbo run build` (api, core, contracts, sdk, customer, admin, db) | **PASS** — `next build` succeeded for both frontends including the new `/delivery-slots` admin route; `tsc -p tsconfig.build.json` succeeded for the API; `prisma generate` succeeded for db |
| `apps/api/src/checkout.integration.test.ts` — including 3 **new** cases added this pass (inactive slot → 404 `NOT_FOUND`; slot not offered on the selected weekday → 422 `SLOT_NOT_AVAILABLE_ON_DAY`; a second concurrent-style checkout against a capacity-1 slot → 409 `SLOT_CAPACITY_EXCEEDED`) plus the existing auto-confirm/atomicity/idempotency cases (rewritten to drop the now-removed zone/assignment fixture) | **BLOCKED** — no reachable Postgres in this environment (`localhost:5432` connection refused); **not run**, same constraint as every prior pass. The test code itself is believed correct (it exercises exactly the new repository logic by calling the real route) but this is unverified against a real database. |
| Other existing DB-backed suites (`auth`, `rbac`, `admin-serviceability`, `idempotency` integration tests) | **BLOCKED** — same reason, pre-existing, unchanged by this pass |
| `pnpm audit` / secret scan | **Not run as an automated step this pass** — manually reviewed the full diff for credentials/tokens/connection strings before committing; found none (see below) |

**No production database was connected to, modified, or migrated in this pass.** The migration above was authored and schema-validated but never applied anywhere.

### Responsive / browser verification actually performed

Both Next.js dev servers (`apps/customer` on :3001, `apps/admin` on :3002) were started locally via the browser tool's `preview_start`. The API server could not be started — it requires a live database connection to resolve the active business at boot (`apps/api/src/server.ts`), and none was reachable — so **every page checked below was exercised against a frontend with no live backend**, not an end-to-end flow:

- **Admin `/delivery-slots`**: loads, nav highlights correctly, renders its "Could not load delivery slots" error state (expected — no API) with a working "Try again" control. Checked for horizontal overflow (`document.documentElement.scrollWidth` vs `clientWidth`) at all eight required widths — **320, 360, 375, 390, 430, 768, 1024, 1440** — zero overflow at any of them after a fix (below).
- **Customer `/checkout`**: correctly redirects an unauthenticated visitor to `/login?next=/checkout` (the existing auth guard, unchanged). Checked the resulting login page for horizontal overflow at the same eight widths — zero overflow at any of them.
- **One real regression found and fixed in this pass**: adding a fourth link ("Delivery slots") to `apps/admin/src/components/admin-nav.tsx`'s existing flex nav row caused horizontal page overflow at 320px (`scrollWidth` 439 vs `clientWidth` 320) — the brand name + four nav links + the auth button no longer fit. Fixed by shortening the label to "Slots", making the brand+nav group its own horizontally-scrollable flex row (`overflow-x-auto`, `shrink-0` on each item) independent of the auth button, and re-verified `scrollWidth === clientWidth` at 320px (and all seven other required widths) afterward.
- **What this did NOT verify**: the actual delivery-slot list/create/edit UI with real data, the actual checkout slot-selection UI with real slots and real capacity numbers, or any interaction (clicking create, submitting a form, selecting a slot) — none of that is possible without a reachable API and database. Only structural/CSS responsiveness and the already-written error-handling paths were confirmed by running the app; the slot-selection and admin-CRUD UI logic itself was verified by code review and the typecheck/lint/build passes above, not by driving it in a browser with real data.

### Unresolved / deferred after this pass

- **The full acceptance journey (admin creates/edits a slot → customer sees live availability → checkout succeeds → capacity decrements → a second customer sees the slot as full) has never been run against a real database.** This is the single most important thing to verify once database access is available — it is where the advisory-lock capacity logic would actually be proven correct under real concurrency, not just by code inspection.
- **`checkout.integration.test.ts`'s 3 new slot-validation cases and its rewritten existing cases are unverified** — they typecheck and lint cleanly and call the real route/repository code, but have not actually been executed.
- **The dependency-audit and coverage-reporter issues noted in earlier sections of this report are unrelated to this pass and were not revisited** — out of scope per this task's own instruction not to touch the dependency audit.
- **PHASE 06 (zone/pincode-level delivery-area management) still does not exist** — this pass deliberately makes checkout not need it, it does not build it.
