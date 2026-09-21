# 04 — Database Design

PostgreSQL 16. This document is the authoritative schema specification. Prisma models and
SQL migrations must match it; if they diverge, this document is amended in the same PR.

## 1. Global conventions

| Convention | Rule |
|---|---|
| Naming | `snake_case`, plural table names, singular column names |
| Primary key | `id UUID PRIMARY KEY` — **UUIDv7** generated in the application |
| Foreign key | `<entity>_id`, always indexed, always with an explicit `ON DELETE` |
| Money | `BIGINT` **paise** (integer minor units). Never `float`/`real`/`double` |
| Timestamps | `TIMESTAMPTZ` stored in UTC; `created_at`, `updated_at` on every table |
| Business dates | `DATE` for service/delivery dates, interpreted in `Asia/Kolkata` |
| Clock times | `TIME` for slot start/end/cutoff, interpreted in `Asia/Kolkata` |
| Soft delete | `deleted_at TIMESTAMPTZ NULL` **only** where listed in §1.4 |
| Status | Native PostgreSQL `ENUM` types for closed sets |
| Free-form | `JSONB` only for genuinely open payloads; never for queryable business fields |
| Text | `TEXT` (never `VARCHAR(n)`); length limits enforced by `CHECK` or by Zod |
| Slugs/emails | `CITEXT` for case-insensitive uniqueness |
| Audit columns | `created_by`, `updated_by` (`UUID NULL` → `users.id`) on admin-mutable tables |

### 1.1 Why UUIDv7 and not `bigserial` or UUIDv4

- IDs appear in URLs and in mobile clients; sequential integers leak order volume and invite
  enumeration.
- UUIDv4 is random, which fragments B-tree indexes and hurts insert locality on hot tables
  (`orders`, `order_items`, `audit_logs`).
- UUIDv7 is time-ordered: index locality of a sequence with the opacity of a UUID, and it
  sorts by creation time for free.
- Generated in the application so that a multi-row aggregate (order + items + status +
  outbox event) can be constructed before the transaction commits.

**ADR-012.**

### 1.2 Why money is `BIGINT` paise

Floating point cannot represent `0.1` exactly, and `₹33.33 × 3` must never become `₹99.98`.
`NUMERIC(12,2)` is exact but arrives in JavaScript as a string or a lossy number and invites
accidental `parseFloat`. Integer minor units are exact, sum and divide predictably, serialise
as JSON numbers safely below 2^53, and match what every payment gateway expects.

- Storage: `BIGINT`, always paise. `₹149.50` → `14950`.
- Column naming: every money column ends in `_paise` so a mistake is visible in review.
- API: money is returned as `{ "amount_paise": 14950, "currency": "INR", "display": "₹149.50" }`.
- Formatting happens exactly once, in `packages/core/src/domain/money.ts`.
- Tax and discount rounding: compute per line in paise, round **half-up** at the line level,
  and make the order total the sum of rounded lines — so the invoice always adds up.

**ADR-006.**

### 1.3 Timezone handling

- All `TIMESTAMPTZ` values are UTC. The database `timezone` is `UTC`.
- The business operates in **one** timezone, `Asia/Kolkata`, stored in
  `businesses.timezone` so that a second city in another zone is possible later.
- "Today", cutoff comparisons and slot windows are computed by converting `now()` into the
  business timezone in `packages/core/src/domain/time.ts`. No route handler does date math.
- `service_date` is a bare `DATE` on purpose: 2026-03-14's morning slot is the same business
  day regardless of DST or server locale.

**ADR-007.**

### 1.4 Soft delete policy

Soft delete is a liability when it is universal (every query needs a filter; unique indexes
break; GDPR-style erasure becomes ambiguous). It is applied only where history must survive
a removal:

| Soft-deleted | Reason |
|---|---|
| `categories`, `products`, `product_variants`, `combos` | Referenced by historical orders |
| `addresses` | Referenced by past orders; customer "deletes" it from their book |
| `admin_users` | Referenced by `audit_logs`; accounts are deactivated, not erased |
| `delivery_slots`, `delivery_zones` | Referenced by past orders and active subscriptions |

Hard-deleted (no `deleted_at`): `cart_items`, `favorites`, `notifications`,
`idempotency_keys`, `slot_capacity` (rolled off), outbox rows after retention.

Never deleted: `orders`, `order_items`, `order_status_history`, `payments`,
`inventory_movements`, `audit_logs`, `subscription_deliveries`.

**Unique indexes on soft-deletable tables are partial:**
`CREATE UNIQUE INDEX ... ON products (business_id, slug) WHERE deleted_at IS NULL;`

### 1.5 Enumerated types

```sql
CREATE TYPE user_type          AS ENUM ('CUSTOMER','ADMIN');
CREATE TYPE account_status     AS ENUM ('ACTIVE','SUSPENDED','DEACTIVATED');
CREATE TYPE product_status     AS ENUM ('DRAFT','ACTIVE','INACTIVE','ARCHIVED');
CREATE TYPE availability_state AS ENUM ('AVAILABLE','OUT_OF_STOCK','DISCONTINUED');
CREATE TYPE order_status       AS ENUM (
  'PENDING','CONFIRMED','PREPARING','READY_FOR_DISPATCH','OUT_FOR_DELIVERY',
  'DELIVERED','CANCELLED','FAILED','RETURNED');
CREATE TYPE order_source       AS ENUM ('ONE_TIME','SUBSCRIPTION');
CREATE TYPE order_channel      AS ENUM ('WEB','MOBILE','ADMIN','SYSTEM');
CREATE TYPE cancel_actor       AS ENUM ('CUSTOMER','ADMIN','SYSTEM');
CREATE TYPE payment_method     AS ENUM ('COD','ONLINE','WALLET','CREDIT');
CREATE TYPE payment_status     AS ENUM (
  'DUE','AUTHORIZED','PAID','PARTIALLY_REFUNDED','REFUNDED','FAILED','CANCELLED');
CREATE TYPE refund_status      AS ENUM ('PENDING','PROCESSING','COMPLETED','FAILED');
CREATE TYPE subscription_status AS ENUM (
  'DRAFT','ACTIVE','PAUSED','CANCELLED','EXPIRED','SUSPENDED');
CREATE TYPE sub_delivery_status AS ENUM (
  'SCHEDULED','SKIPPED','ORDER_CREATED','FULFILLED','FAILED','CANCELLED');
CREATE TYPE frequency_type     AS ENUM ('DAILY','WEEKLY','CUSTOM_DAYS','ALTERNATE_DAYS','MONTHLY');
CREATE TYPE inventory_reason   AS ENUM (
  'PURCHASE','PRODUCTION','ORDER_RESERVED','ORDER_RELEASED','ORDER_CONSUMED',
  'MANUAL_ADJUSTMENT','WASTAGE','DAMAGE','RETURN','EXPIRY','STOCK_TAKE');
CREATE TYPE notification_channel AS ENUM ('IN_APP','EMAIL','WHATSAPP','PUSH','SMS');
CREATE TYPE outbox_status      AS ENUM ('PENDING','PROCESSING','SENT','FAILED','DEAD');
CREATE TYPE discount_type      AS ENUM ('PERCENTAGE','FIXED');
CREATE TYPE image_status       AS ENUM ('PENDING','READY','FAILED');
```

**Enum evolution policy:** new values are added with `ALTER TYPE ... ADD VALUE`, which is
non-blocking. Values are never removed or renamed; a retired value is simply no longer
written. If a set starts churning weekly, it is a sign it should be a lookup table instead.

### 1.6 Delete behaviour policy

| Relationship | Behaviour | Why |
|---|---|---|
| `order_items → orders` | `ON DELETE CASCADE` | Items have no meaning without the order (orders are never deleted in practice) |
| `order_items → product_variants` | `ON DELETE RESTRICT` | Historical orders must never lose their referent |
| `cart_items → carts` | `ON DELETE CASCADE` | Carts are disposable |
| `subscription_items → subscriptions` | `ON DELETE CASCADE` | — |
| `subscription_deliveries → subscriptions` | `ON DELETE RESTRICT` | Delivery history is financial history |
| `orders → subscription_deliveries` | `ON DELETE SET NULL` | An order survives even if the link is severed |
| `addresses → customer_profiles` | `ON DELETE RESTRICT` | Soft delete instead |
| `orders → addresses` | `ON DELETE RESTRICT` **plus a snapshot** | See §6.2 |
| `audit_logs → users` | `ON DELETE SET NULL` | The log entry outlives the account |
| `role_permissions → roles/permissions` | `ON DELETE CASCADE` | Join table |

### 1.7 Snapshot principle

Orders and subscription deliveries **snapshot** everything that could change later:
product name, variant label, unit price, discount, tax rate, address text, slot window, and
customer name/phone. A price change or an address edit in 2027 must not silently rewrite a
2026 invoice. Snapshot columns coexist with the foreign key: the FK is for joins and
reporting, the snapshot is for truth.

## 2. Schema map

```
GOVERNANCE   businesses · settings · audit_logs · job_runs
IDENTITY     users · customer_profiles · admin_users · roles · permissions
             role_permissions · admin_user_roles · addresses
CATALOGUE    categories · products · product_variants · product_images
             tags · product_tags · combos · combo_items · product_zone_availability
INVENTORY    inventory · inventory_movements · (P2: inventory_batches)
SERVICEABILITY cities · service_pincodes                      [PHASE 01]
FULFILMENT   delivery_zones · delivery_slots
             slot_zone_assignments · slot_capacity · business_holidays
ORDERING     carts · cart_items · orders · order_items · order_status_history
             idempotency_keys
SUBSCRIPTION subscription_plans · subscription_plan_items · subscriptions
             subscription_items · subscription_deliveries · subscription_events
PAYMENT      payments · payment_attempts · refunds · payment_webhook_events
ENGAGEMENT   notification_outbox · notifications · notification_logs
             notification_preferences · favorites · (P2: reviews)
PROMOTION    (P2: coupons · coupon_redemptions · promotions)
CONTENT      (P2: content_blocks · faqs · banners)
```

## 3. Governance

### 3.1 `businesses`
**Purpose:** the operating entity. Exactly one row at MVP; the column that makes multi-business
expansion a data change rather than a migration (ADR-005).

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | UUID | NO | PK |
| `name` | TEXT | NO | Legal/display name |
| `slug` | CITEXT | NO | UNIQUE |
| `timezone` | TEXT | NO | Default `'Asia/Kolkata'` |
| `currency` | TEXT | NO | Default `'INR'`, ISO 4217 |
| `support_email` | CITEXT | YES | |
| `support_phone` | TEXT | YES | |
| `status` | account_status | NO | Default `ACTIVE` |
| `created_at` / `updated_at` | TIMESTAMPTZ | NO | |

**Scope rule (clarified in PHASE 02).** `business_id` is carried by every **aggregate
root** — the tables that are queried directly and must be scoped: `cities`,
`service_pincodes`, `categories`, `products`, `product_variants`, `combos`, `tags`,
`delivery_zones`, `delivery_slots`, `business_holidays`, `carts`, `orders`,
`subscription_plans`, `subscriptions`, `inventory`, `coupons`, `roles`, `admin_users`,
`customer_profiles`, `settings`.

Child tables (`order_items`, `cart_items`, `combo_items`, `subscription_items`,
`inventory_movements`, …) do **not** repeat it: they are only ever reached through a parent
that is already scoped, and duplicating the column would add foreign keys that no query
uses while creating a second place for the value to disagree.

`product_variants` is the notable exception among children — it carries `business_id` so
that the documented per-business SKU uniqueness is an enforceable index, and it uses a
composite FK to `products(id, business_id)` so a variant cannot cross a tenant boundary
(ADR-029, ADR-032).

### 3.2 `settings`
**Purpose:** runtime configuration an admin can change without a deploy (booking horizon,
default delivery fee, minimum order value, subscription pause limits, support hours).

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | UUID | NO | PK |
| `key` | CITEXT | NO | e.g. `booking.horizon_days` |
| `value` | JSONB | NO | Typed and validated by a Zod schema registry in `core` |
| `description` | TEXT | YES | |
| `is_public` | BOOLEAN | NO | Default `false`; public keys are exposed to clients |
| `updated_by` | UUID | YES | → `users.id` |
| `created_at` / `updated_at` | TIMESTAMPTZ | NO | |

**UNIQUE** `(business_id, key)`. Cached in-process for 60s.

### 3.3 `audit_logs`
**Purpose:** durable, queryable business audit. Distinct from technical logs (doc 28).

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | UUID | NO | PK |
| `actor_user_id` | UUID | YES | → `users.id` `ON DELETE SET NULL`; NULL for SYSTEM |
| `actor_type` | TEXT | NO | `ADMIN` / `CUSTOMER` / `SYSTEM` |
| `actor_email` | CITEXT | YES | Snapshot — survives account deletion |
| `action` | TEXT | NO | `order.status_changed`, `product.updated`, `admin_user.role_granted` |
| `resource_type` | TEXT | NO | `order`, `product`, `subscription` |
| `resource_id` | UUID | YES | |
| `before` | JSONB | YES | Changed fields only, PII-redacted |
| `after` | JSONB | YES | Changed fields only, PII-redacted |
| `metadata` | JSONB | YES | `{ reason, request_id, source }` |
| `ip_address` | INET | YES | |
| `user_agent` | TEXT | YES | |
| `created_at` | TIMESTAMPTZ | NO | |

**Indexes:** `(resource_type, resource_id, created_at DESC)`, `(actor_user_id, created_at DESC)`,
`(action, created_at DESC)`, BRIN on `created_at`.
**Append-only:** no `UPDATE`/`DELETE` grant for the application role. Retention 24 months,
then archived to R2.

### 3.4 `job_runs`
**Purpose:** execution record for every scheduled worker job. Powers the admin job-health
screen and the dead-man's-switch alerts in [28-OBSERVABILITY.md](28-OBSERVABILITY.md) §8.

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | UUID | NO | PK |
| `job_name` | TEXT | NO | `generate-subscription-deliveries` |
| `started_at` | TIMESTAMPTZ | NO | |
| `finished_at` | TIMESTAMPTZ | YES | NULL while running |
| `status` | TEXT | NO | `RUNNING` / `SUCCEEDED` / `FAILED` |
| `items_processed` | INTEGER | NO | Default 0 |
| `error` | TEXT | YES | |
| `metadata` | JSONB | YES | Per-job counters |
| `created_at` | TIMESTAMPTZ | NO | |

**Indexes:** `(job_name, started_at DESC)`. Retained 90 days.
A run that is still `RUNNING` past its expected duration is itself an alert condition.

## 4. Identity

See [07-AUTHENTICATION-AUTHORIZATION.md](07-AUTHENTICATION-AUTHORIZATION.md) for flows and
[08-RBAC-PERMISSIONS.md](08-RBAC-PERMISSIONS.md) for the permission catalogue.

### 4.1 `users`
**Purpose:** the bridge between a Firebase identity and our application. One row per Firebase
UID per audience. It holds **no credentials** — no password hash, no OTP, no refresh token.

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | UUID | NO | PK — our internal identity, used in every FK |
| `firebase_uid` | TEXT | NO | From the verified ID token |
| `user_type` | user_type | NO | `CUSTOMER` or `ADMIN` |
| `email` | CITEXT | YES | Mirrored from Firebase; not authoritative for auth |
| `phone` | TEXT | YES | E.164, e.g. `+919876543210` |
| `email_verified` | BOOLEAN | NO | Default `false` |
| `phone_verified` | BOOLEAN | NO | Default `false` |
| `status` | account_status | NO | Default `ACTIVE`. Checked on **every** request |
| `last_login_at` | TIMESTAMPTZ | YES | |
| `created_at` / `updated_at` | TIMESTAMPTZ | NO | |

**UNIQUE** `(firebase_uid, user_type)` — the same person could in principle be both a customer
and an admin, with two rows and two Firebase identities in two projects.
**UNIQUE partial** `(phone) WHERE user_type='CUSTOMER' AND phone IS NOT NULL`.
**Index** `(user_type, status)`.

> `status` lives here and not only in Firebase because suspension must be instant. A Firebase
> ID token is valid for up to an hour after issuance; checking `users.status` on every request
> makes a ban take effect on the next call. See BR-SEC3.

### 4.2 `customer_profiles`
**Purpose:** customer business data. Separated from `users` so that identity concerns and
commercial concerns evolve independently, and so a future admin-created "offline customer"
needs no Firebase identity.

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | UUID | NO | PK |
| `user_id` | UUID | NO | → `users.id` `ON DELETE RESTRICT`, **UNIQUE** |
| `first_name` | TEXT | YES | |
| `last_name` | TEXT | YES | |
| `display_name` | TEXT | YES | Generated for UI convenience |
| `date_of_birth` | DATE | YES | Optional; used for birthday campaigns later |
| `gender` | TEXT | YES | Free text, optional |
| `default_address_id` | UUID | YES | → `addresses.id` `ON DELETE SET NULL` |
| `preferred_slot_id` | UUID | YES | → `delivery_slots.id` `ON DELETE SET NULL` |
| `marketing_opt_in` | BOOLEAN | NO | Default `false` — explicit consent |
| `total_orders` | INTEGER | NO | Default 0, denormalised counter |
| `lifetime_value_paise` | BIGINT | NO | Default 0, denormalised |
| `first_order_at` | TIMESTAMPTZ | YES | Drives first-order coupon eligibility |
| `last_order_at` | TIMESTAMPTZ | YES | Drives churn reporting |
| `notes` | TEXT | YES | Internal CS notes — **never shown to the customer** |
| `created_at` / `updated_at` | TIMESTAMPTZ | NO | |

Counters are maintained inside the order transaction, and a nightly reconciliation job
recomputes them defensively.

### 4.3 `admin_users`
**Purpose:** staff business data, separate from customer profiles for security and clarity.

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | UUID | NO | PK |
| `user_id` | UUID | NO | → `users.id`, **UNIQUE** |
| `full_name` | TEXT | NO | |
| `employee_code` | TEXT | YES | UNIQUE per business, nullable |
| `designation` | TEXT | YES | |
| `is_super_admin` | BOOLEAN | NO | Default `false` — bypasses permission checks |
| `mfa_enabled` | BOOLEAN | NO | Default `false` (P2 enforcement) |
| `last_password_change_at` | TIMESTAMPTZ | YES | |
| `invited_by` | UUID | YES | → `users.id` |
| `invitation_accepted_at` | TIMESTAMPTZ | YES | |
| `deleted_at` | TIMESTAMPTZ | YES | Soft delete |
| `created_at` / `updated_at` | TIMESTAMPTZ | NO | |

**Invariant:** at least one active `is_super_admin` user must exist. Enforced in the service
layer (the last super admin cannot be demoted or deactivated) — BR-SEC6.

### 4.4 `roles`, `permissions`, `role_permissions`, `admin_user_roles`

`roles`

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | UUID | NO | PK |
| `key` | CITEXT | NO | UNIQUE per business, e.g. `OPERATIONS_MANAGER` |
| `name` | TEXT | NO | Display name |
| `description` | TEXT | YES | |
| `is_system` | BOOLEAN | NO | System roles cannot be deleted or renamed |
| `created_at` / `updated_at` | TIMESTAMPTZ | NO | |

`permissions` — a static catalogue seeded by migration, not admin-editable.

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | UUID | NO | PK |
| `key` | CITEXT | NO | UNIQUE, `resource:action`, e.g. `orders:update_status` |
| `resource` | TEXT | NO | `orders` |
| `action` | TEXT | NO | `read` / `create` / `update` / `delete` / custom |
| `description` | TEXT | NO | |

`role_permissions` — PK `(role_id, permission_id)`, both FKs `ON DELETE CASCADE`.
`admin_user_roles` — PK `(admin_user_id, role_id)`, plus `granted_by UUID`, `granted_at`.
An admin may hold multiple roles; effective permissions are the **union**.

### 4.5 `addresses`
**Purpose:** the customer address book. Also the serviceability anchor.

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | UUID | NO | PK |
| `customer_profile_id` | UUID | NO | → `customer_profiles.id` `ON DELETE RESTRICT` |
| `label` | TEXT | YES | `Home`, `Office` |
| `recipient_name` | TEXT | NO | |
| `recipient_phone` | TEXT | NO | E.164 |
| `line1` | TEXT | NO | House/flat, building |
| `line2` | TEXT | YES | Street, area |
| `landmark` | TEXT | YES | |
| `city` | TEXT | NO | What the customer typed — a snapshot |
| `city_id` | UUID | YES | → `cities.id` `ON DELETE SET NULL`; the resolved match (ADR-029) |
| `state` | TEXT | NO | |
| `pincode` | TEXT | NO | `CHECK (pincode ~ '^[1-9][0-9]{5}$')` |
| `country` | TEXT | NO | Default `'IN'` |
| `latitude` | NUMERIC(10,7) | YES | For future geo-zones and routing |
| `longitude` | NUMERIC(10,7) | YES | |
| `delivery_zone_id` | UUID | YES | → `delivery_zones.id`; resolved from pincode on save |
| `delivery_instructions` | TEXT | YES | |
| `is_default` | BOOLEAN | NO | Default `false` |
| `deleted_at` | TIMESTAMPTZ | YES | Soft delete |
| `created_at` / `updated_at` | TIMESTAMPTZ | NO | |

**Indexes:** `(customer_profile_id) WHERE deleted_at IS NULL`, `(pincode)`, `(delivery_zone_id)`.
**Partial unique:** `(customer_profile_id) WHERE is_default AND deleted_at IS NULL` — exactly
one default address.
`delivery_zone_id` is **cached** at save time and **re-resolved at checkout**, because zone
boundaries can change (EC-D4).

## 5. Catalogue

### 5.1 `categories`
Self-referencing for a two-level hierarchy (category → subcategory). Deeper nesting is
allowed by the schema but not by the UI (BR-C1).

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | UUID | NO | PK |
| `parent_id` | UUID | YES | → `categories.id` `ON DELETE RESTRICT` |
| `name` | TEXT | NO | |
| `slug` | CITEXT | NO | Partial-unique per business where not deleted |
| `description` | TEXT | YES | |
| `image_url` | TEXT | YES | R2/CDN URL |
| `icon_url` | TEXT | YES | Small icon for the category rail |
| `display_order` | INTEGER | NO | Default 0 |
| `is_active` | BOOLEAN | NO | Default `true` |
| `seo_title` / `seo_description` | TEXT | YES | Marketing site metadata |
| `deleted_at` | TIMESTAMPTZ | YES | |
| `created_at` / `updated_at` / `created_by` / `updated_by` | | | |

**Indexes:** `(parent_id, display_order)`, `(is_active) WHERE deleted_at IS NULL`.
**CHECK:** `parent_id <> id`. Depth is enforced in the service layer.

### 5.2 `products`
**Purpose:** the marketing and informational entity. **It is not purchasable.** Only a
variant is purchasable (see §5.3) — this removes the classic "does this product have a price
or does its variant?" ambiguity that plagues ecommerce schemas.

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | UUID | NO | PK |
| `category_id` | UUID | NO | → `categories.id` `ON DELETE RESTRICT` |
| `name` | TEXT | NO | `Fruit Chaat Bowl` |
| `slug` | CITEXT | NO | Partial-unique per business |
| `short_description` | TEXT | YES | Card copy, ≤ 140 chars |
| `description` | TEXT | YES | Long copy, markdown |
| `status` | product_status | NO | `DRAFT` / `ACTIVE` / `INACTIVE` / `ARCHIVED` |
| `is_subscribable` | BOOLEAN | NO | Default `false` (FR-S1) |
| `is_featured` | BOOLEAN | NO | Default `false` |
| `is_bestseller` | BOOLEAN | NO | Default `false` |
| `is_new` | BOOLEAN | NO | Default `false` |
| `popularity_score` | INTEGER | NO | Default 0; recomputed nightly from sales |
| `ingredients` | TEXT | YES | Human-readable list |
| `nutrition` | JSONB | YES | See §5.2.1 |
| `allergens` | TEXT[] | YES | `{'nuts','dairy'}` |
| `preparation_note` | TEXT | YES | "Cut fresh on the morning of delivery" |
| `storage_note` | TEXT | YES | "Refrigerate, consume within 8 hours" |
| `shelf_life_hours` | INTEGER | YES | Drives perishability logic later |
| `dietary_tags` | TEXT[] | YES | `{'vegan','high-protein','no-added-sugar'}` |
| `seo_title` / `seo_description` | TEXT | YES | |
| `search_vector` | TSVECTOR | YES | Generated column, see §5.2.2 |
| `published_at` | TIMESTAMPTZ | YES | First transition to `ACTIVE` |
| `deleted_at` | TIMESTAMPTZ | YES | |
| `created_at` / `updated_at` / `created_by` / `updated_by` | | | |

**Indexes:** `(category_id, status)`, `(status) WHERE deleted_at IS NULL`,
`GIN(search_vector)`, `GIN(dietary_tags)`, `(popularity_score DESC)`,
partial indexes on `is_featured` / `is_bestseller` where `status='ACTIVE'`.

#### 5.2.1 `nutrition` JSONB shape
Validated by Zod on write; `JSONB` because the set of measured nutrients varies by product
and is displayed, not queried.

```json
{
  "serving_size": "150g",
  "calories_kcal": 120,
  "protein_g": 2.4,
  "carbohydrates_g": 28.1,
  "of_which_sugars_g": 22.0,
  "fat_g": 0.6,
  "of_which_saturates_g": 0.1,
  "fibre_g": 3.2,
  "sodium_mg": 12,
  "source": "LAB_TESTED"
}
```
If nutrition ever needs filtering ("under 150 kcal"), the hot fields are promoted to real
columns — a documented, non-breaking migration.

#### 5.2.2 `search_vector`
```sql
ALTER TABLE products ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(name,'')), 'A') ||
    setweight(to_tsvector('simple', coalesce(short_description,'')), 'B') ||
    setweight(to_tsvector('simple', array_to_string(coalesce(dietary_tags,'{}'), ' ')), 'C') ||
    setweight(to_tsvector('simple', coalesce(description,'')), 'D')
  ) STORED;
```
`'simple'` rather than `'english'` because the catalogue mixes English and transliterated
Hindi (`chaat`, `moong`) where stemming does more harm than good. Fuzzy matching is handled
separately by `pg_trgm` on `name`.

### 5.3 `product_variants`
**Purpose:** the **only purchasable unit**. Every cart line, order line, combo item,
subscription item and inventory row points at a variant. A product with a single size still
has exactly one variant.

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | UUID | NO | PK |
| `product_id` | UUID | NO | → `products.id` `ON DELETE RESTRICT` |
| `sku` | CITEXT | NO | Partial-unique per business |
| `name` | TEXT | NO | `250g`, `Regular`, `Family Pack` |
| `unit` | TEXT | NO | `g`, `ml`, `piece`, `bowl`, `pack` |
| `unit_value` | NUMERIC(10,3) | NO | `250.000` |
| `mrp_paise` | BIGINT | YES | Printed price; nullable for prepared items with no MRP |
| `price_paise` | BIGINT | NO | Selling price. `CHECK (price_paise >= 0)` |
| `subscription_price_paise` | BIGINT | YES | Overrides `price_paise` for subscription lines |
| `cost_paise` | BIGINT | YES | Internal only — **never** exposed by a customer endpoint |
| `tax_rate_bps` | INTEGER | NO | Basis points, default 0. `500` = 5% GST |
| `availability` | availability_state | NO | Default `AVAILABLE` |
| `is_default` | BOOLEAN | NO | The variant preselected on the product page |
| `display_order` | INTEGER | NO | Default 0 |
| `max_order_quantity` | INTEGER | YES | Per-order cap (BR-K4) |
| `deleted_at` | TIMESTAMPTZ | YES | |
| `created_at` / `updated_at` | TIMESTAMPTZ | NO | |

**CHECK:** `mrp_paise IS NULL OR mrp_paise >= price_paise` — discount can never be negative.
**CHECK:** `subscription_price_paise IS NULL OR subscription_price_paise <= price_paise`.
**Partial unique:** `(product_id) WHERE is_default AND deleted_at IS NULL`.
**Indexes:** `(product_id, display_order)`, `(availability)`.

> **Availability vs stock.** `availability` is an *editorial* decision by an admin
> ("we are not selling this"). Stock is a *quantitative* fact in `inventory`. A line is
> purchasable only when the product is `ACTIVE` **and** the variant is `AVAILABLE` **and**
> available stock ≥ requested quantity. Keeping these separate is what lets ops pull an item
> for quality reasons without corrupting stock counts (BR-C4).

### 5.4 `product_images`

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | UUID | NO | PK |
| `product_id` | UUID | NO | → `products.id` `ON DELETE CASCADE` |
| `variant_id` | UUID | YES | → `product_variants.id` `ON DELETE CASCADE`; NULL = product-level |
| `storage_key` | TEXT | NO | R2 object key — the durable reference |
| `url` | TEXT | NO | Public CDN URL |
| `alt_text` | TEXT | YES | Required for accessibility; enforced by API validation |
| `width` / `height` | INTEGER | YES | Populated after validation; prevents layout shift |
| `blur_data_url` | TEXT | YES | Tiny base64 LQIP placeholder |
| `status` | image_status | NO | `PENDING` → `READY` after worker validation |
| `display_order` | INTEGER | NO | Default 0 |
| `created_at` / `updated_at` | TIMESTAMPTZ | NO | |

**Partial unique:** `(product_id) WHERE display_order = 0` — exactly one primary image.

### 5.5 `tags` and `product_tags`
Free-form merchandising tags (`summer-special`, `office-favourite`) distinct from
`dietary_tags`, which are a controlled vocabulary used for filtering.
`tags`: `id`, `key CITEXT UNIQUE`, `name`, `type` (`MERCH` / `DIET`), `is_active`.
`product_tags`: PK `(product_id, tag_id)`, both `ON DELETE CASCADE`.

### 5.6 `combos`
**Purpose:** a bundle sold as one purchasable line at a bundle price.

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | UUID | NO | PK |
| `name` | TEXT | NO | `Morning Wellness Combo` |
| `slug` | CITEXT | NO | Partial-unique |
| `short_description` / `description` | TEXT | YES | |
| `image_url` | TEXT | YES | |
| `pricing_mode` | TEXT | NO | `FIXED` or `DISCOUNT` — `CHECK (pricing_mode IN ('FIXED','DISCOUNT'))` |
| `price_paise` | BIGINT | YES | Required when `pricing_mode='FIXED'` |
| `discount_type` | discount_type | YES | Required when `pricing_mode='DISCOUNT'` |
| `discount_value` | INTEGER | YES | Percent basis points, or paise |
| `subscription_price_paise` | BIGINT | YES | Optional subscription-specific price |
| `status` | product_status | NO | |
| `is_subscribable` | BOOLEAN | NO | Default `false` |
| `is_featured` | BOOLEAN | NO | |
| `display_order` | INTEGER | NO | |
| `available_from` / `available_until` | DATE | YES | Seasonal combos |
| `seo_title` / `seo_description` | TEXT | YES | |
| `deleted_at` | TIMESTAMPTZ | YES | |
| `created_at` / `updated_at` / `created_by` / `updated_by` | | | |

**CHECK:** `(pricing_mode='FIXED' AND price_paise IS NOT NULL) OR (pricing_mode='DISCOUNT' AND discount_type IS NOT NULL AND discount_value IS NOT NULL)`.

### 5.7 `combo_items`

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | UUID | NO | PK |
| `combo_id` | UUID | NO | → `combos.id` `ON DELETE CASCADE` |
| `variant_id` | UUID | NO | → `product_variants.id` `ON DELETE RESTRICT` |
| `quantity` | INTEGER | NO | `CHECK (quantity > 0)` |
| `display_order` | INTEGER | NO | |

**UNIQUE** `(combo_id, variant_id)`.
A combo **explodes into its component variants** at order time so that inventory,
prep lists and wastage are always tracked at variant level — see
[12-COMBO-SYSTEM.md](12-COMBO-SYSTEM.md).

### 5.8 `product_zone_availability`
**Purpose:** per-zone availability without duplicating the catalogue (ADR-005). Absence of a
row means "available everywhere" — so MVP writes no rows at all.

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | UUID | NO | PK |
| `variant_id` | UUID | YES | → `product_variants.id` `ON DELETE CASCADE` |
| `combo_id` | UUID | YES | → `combos.id` `ON DELETE CASCADE` |
| `delivery_zone_id` | UUID | NO | → `delivery_zones.id` `ON DELETE CASCADE` |
| `is_available` | BOOLEAN | NO | |
| `price_override_paise` | BIGINT | YES | Zone-specific pricing, future |

**CHECK:** exactly one of `variant_id` / `combo_id` is non-null.
**UNIQUE** `(variant_id, delivery_zone_id)` and `(combo_id, delivery_zone_id)`.

## 6. Serviceability and fulfilment

`cities` and `service_pincodes` (§6.2–6.4) ship in **PHASE 01**; zones, slots and capacity
ship in **PHASE 06**. Behaviour is specified in [10-DELIVERY-SLOT-SYSTEM.md](10-DELIVERY-SLOT-SYSTEM.md).

### 6.1 `delivery_zones`

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | UUID | NO | PK |
| `name` | TEXT | NO | `South Bengaluru — Zone 1` |
| `code` | CITEXT | NO | UNIQUE per business |
| `city_id` | UUID | NO | → `cities.id` `ON DELETE RESTRICT`. Replaces the free-text `city`/`state` columns: a zone is operational configuration and must name a known city (ADR-029) |
| `delivery_fee_paise` | BIGINT | NO | Default 0 |
| `free_delivery_above_paise` | BIGINT | YES | Waives the fee above this subtotal |
| `min_order_value_paise` | BIGINT | NO | Default 0 |
| `max_daily_orders` | INTEGER | YES | Zone-wide daily cap across all slots |
| `is_active` | BOOLEAN | NO | Default `true` |
| `display_order` | INTEGER | NO | |
| `deleted_at` | TIMESTAMPTZ | YES | |
| `created_at` / `updated_at` | TIMESTAMPTZ | NO | |

### 6.2 `cities` **[PHASE 01]**
**Purpose:** a city the business operates in, or intends to. The top level of the
admin-controlled serviceability model (ADR-023).

Cities are **never deleted**. Expansion and retreat are both status changes, because
historical addresses and orders must keep resolving to a real city row forever (BR-SV6).

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | UUID | NO | PK |
| `business_id` | UUID | NO | → `businesses.id` `ON DELETE RESTRICT` |
| `name` | TEXT | NO | `Noida`. `CHECK (length(btrim(name)) > 0)` |
| `slug` | CITEXT | NO | `noida` |
| `display_name` | TEXT | YES | Overrides `name` in customer-facing UI |
| `state` | TEXT | NO | `Uttar Pradesh` |
| `country` | TEXT | NO | Default `'IN'`. `CHECK (country ~ '^[A-Z]{2}$')` |
| `timezone` | TEXT | NO | Default `'Asia/Kolkata'` — a second city could differ |
| `status` | serviceability_status | NO | `ACTIVE` / `INACTIVE` / `COMING_SOON`, default `INACTIVE` |
| `display_order` | INTEGER | NO | Default 0 |
| `activated_at` | TIMESTAMPTZ | YES | When the city went live |
| `created_at` / `updated_at` / `created_by` / `updated_by` | | | |

**UNIQUE** `(business_id, slug)`.
**UNIQUE** `(id, business_id)` — exists solely to support the composite FK in §6.3.
**CHECK** `status <> 'ACTIVE' OR activated_at IS NOT NULL` — an active city must record when
it went live, otherwise "since when have we served Noida" is unanswerable and every
cohort report silently degrades.
**Indexes:** `(business_id, status)`, `(business_id, state)`.

> **Why `status` is an enum and not `is_active BOOLEAN`.** The admin UI must distinguish
> "we have switched this off" from "we have not launched here yet". A boolean cannot carry
> that distinction without a second column, and the two produce genuinely different customer
> messages — one is a refusal, the other is a waitlist opportunity.

### 6.3 `service_pincodes` **[PHASE 01]**
**Purpose:** a pincode the business may deliver to, owned by exactly one city.
Replaces the `zone_pincodes` design from PHASE 00 (ADR-024).

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | UUID | NO | PK |
| `business_id` | UUID | NO | → `businesses.id` `ON DELETE RESTRICT` |
| `city_id` | UUID | NO | → `cities.id` `ON DELETE RESTRICT` |
| `pincode` | TEXT | NO | `CHECK (pincode ~ '^[1-9][0-9]{5}$')` |
| `area_name` | TEXT | YES | Locality label shown in the UI |
| `status` | serviceability_status | NO | Default `INACTIVE` |
| `display_order` | INTEGER | NO | Default 0 |
| `activated_at` | TIMESTAMPTZ | YES | |
| `delivery_zone_id` | UUID | YES | **[PHASE 06]** → `delivery_zones.id`. Null until zones exist |
| `created_at` / `updated_at` / `created_by` / `updated_by` | | | |

**UNIQUE** `(business_id, pincode)` — a pincode resolves to exactly one city per business,
so "is this address serviceable" has exactly one answer (BR-SV2).
**CHECK** `status <> 'ACTIVE' OR activated_at IS NOT NULL`.
**FOREIGN KEY** `(city_id, business_id)` → `cities (id, business_id)` — a composite FK, not
a plain one. A plain `city_id` FK would allow a pincode to attach to *another business's*
city, silently widening serviceability across a tenant boundary. The composite key makes
that unrepresentable rather than merely unlikely (ADR-005, BR-SV3).
**Indexes:** `(city_id, status)`, `(business_id, status)`.

### 6.4 Serviceability resolution

Two stages, evaluated in order. **Stage 2 may only narrow Stage 1, never widen it** (BR-SV8).

```
Stage 1 — PHASE 01, "may we deliver here at all?"
    city.status = ACTIVE  AND  pincode.status = ACTIVE

Stage 2 — PHASE 06, "when, at what fee, with what capacity?"
    zone active  AND  slot available on that date  AND  capacity remaining
```

The city gate runs **first and overrides the pincode**: deactivating a city is sufficient on
its own, without requiring the admin to also deactivate every pincode inside it. An admin who
had to remember both would eventually miss one, and that pincode would keep accepting orders
into a city the business had stopped serving.

Implemented as a pure function in `packages/core/src/domain/serviceability.ts`, exhaustively
unit-tested across all nine (city status × pincode status) combinations.

### 6.5 `delivery_slots`
Admin-configured windows. **No slot times are hard-coded anywhere in the codebase.**

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | UUID | NO | PK |
| `name` | TEXT | NO | `Morning`, `Evening` |
| `code` | CITEXT | NO | UNIQUE per business, stable key for reporting |
| `start_time` | TIME | NO | `06:00` (Asia/Kolkata) |
| `end_time` | TIME | NO | `08:00` |
| `cutoff_time` | TIME | NO | Last time an order may be placed |
| `cutoff_days_before` | INTEGER | NO | Default 0 (same day), 1 = previous day |
| `available_days` | SMALLINT[] | NO | ISO weekdays, `{1,2,3,4,5}` = Mon–Fri |
| `default_capacity` | INTEGER | NO | Orders per date. `CHECK (default_capacity > 0)` |
| `delivery_fee_paise` | BIGINT | YES | Overrides the zone fee when set |
| `min_order_value_paise` | BIGINT | YES | Overrides the zone minimum when set |
| `is_active` | BOOLEAN | NO | Default `true` |
| `display_order` | INTEGER | NO | |
| `deleted_at` | TIMESTAMPTZ | YES | |
| `created_at` / `updated_at` / `created_by` / `updated_by` | | | |

**CHECK:** `end_time > start_time` (overnight slots are explicitly unsupported at MVP).
**CHECK:** `cutoff_days_before >= 0`.

> The pair (`cutoff_time`, `cutoff_days_before`) expresses both "order by 10 PM the night
> before" (`22:00`, `1`) and "order by 4 AM the same morning" (`04:00`, `0`). A single
> timestamp could not express a recurring rule; a single `TIME` could not express "previous
> day". This is the minimum expressive form. See BR-D3.

### 6.6 `slot_zone_assignments`
Which slots serve which zones, with optional per-zone capacity override.
`id`, `delivery_slot_id`, `delivery_zone_id`, `capacity_override INTEGER NULL`,
`is_active BOOLEAN`. **UNIQUE** `(delivery_slot_id, delivery_zone_id)`.
No rows for a slot means it serves **all** zones (MVP convenience).

### 6.7 `slot_capacity`
**Purpose:** the concurrency control point of the entire system. One row per bookable
(slot, date, zone). Created ahead of time by the `roll-slot-capacity` job.

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | UUID | NO | PK |
| `delivery_slot_id` | UUID | NO | → `delivery_slots.id` `ON DELETE CASCADE` |
| `delivery_zone_id` | UUID | NO | → `delivery_zones.id` `ON DELETE CASCADE` |
| `service_date` | DATE | NO | Business date in `Asia/Kolkata` |
| `capacity` | INTEGER | NO | Effective capacity for this date |
| `reserved_for_subscriptions` | INTEGER | NO | Default 0 (P2, FR-D7) |
| `booked_count` | INTEGER | NO | Default 0 |
| `is_blocked` | BOOLEAN | NO | Ad-hoc closure for this date |
| `block_reason` | TEXT | YES | |
| `created_at` / `updated_at` | TIMESTAMPTZ | NO | |

**UNIQUE** `(delivery_slot_id, delivery_zone_id, service_date)` ← the row that is locked with
`SELECT ... FOR UPDATE` during checkout.
**CHECK:** `booked_count >= 0 AND booked_count <= capacity`. The database itself refuses to
be over-booked, so a bug in application code becomes a failed transaction rather than an
undeliverable order (BR-D6).
**Index:** `(service_date, delivery_zone_id)`. Rows older than 90 days are purged.

### 6.8 `business_holidays`
`id`, `holiday_date DATE`, `name`, `delivery_zone_id UUID NULL` (NULL = all zones),
`delivery_slot_id UUID NULL` (NULL = all slots), `is_full_closure BOOLEAN`, `note`.
**UNIQUE** `(business_id, holiday_date, delivery_zone_id, delivery_slot_id)`.
Consulted by the slot-availability service and by the subscription scheduler (BR-D8).

## 7. Ordering

State machine in [09-ORDER-LIFECYCLE.md](09-ORDER-LIFECYCLE.md).

### 7.1 `carts`
One active cart per customer. Guests use a client-side cart merged on login (FR-K3).

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | UUID | NO | PK |
| `customer_profile_id` | UUID | NO | → `customer_profiles.id` `ON DELETE CASCADE` |
| `delivery_address_id` | UUID | YES | Chosen during checkout |
| `delivery_slot_id` | UUID | YES | |
| `service_date` | DATE | YES | |
| `coupon_code` | TEXT | YES | P2 |
| `last_activity_at` | TIMESTAMPTZ | NO | Drives abandoned-cart cleanup and campaigns |
| `created_at` / `updated_at` | TIMESTAMPTZ | NO | |

**Partial unique:** one cart per customer. Carts inactive for 30 days are deleted.
**Totals are never stored on the cart** — they are computed on read from live catalogue
prices, so a cart can never show a stale price (BR-K2).

### 7.2 `cart_items`

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | UUID | NO | PK |
| `cart_id` | UUID | NO | → `carts.id` `ON DELETE CASCADE` |
| `variant_id` | UUID | YES | → `product_variants.id` `ON DELETE CASCADE` |
| `combo_id` | UUID | YES | → `combos.id` `ON DELETE CASCADE` |
| `quantity` | INTEGER | NO | `CHECK (quantity > 0)` |
| `added_at` | TIMESTAMPTZ | NO | |

**CHECK:** exactly one of `variant_id` / `combo_id` is non-null.
**UNIQUE** `(cart_id, variant_id)` and `(cart_id, combo_id)` — adding an existing line
increments quantity rather than creating a duplicate row.

### 7.3 `orders`
The central transactional record. Never deleted, never soft-deleted.

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | UUID | NO | PK |
| `order_number` | TEXT | NO | **UNIQUE**, human-facing, e.g. `HL-2026-0001842` |
| `customer_profile_id` | UUID | NO | → `customer_profiles.id` `ON DELETE RESTRICT` |
| `status` | order_status | NO | Default `PENDING` |
| `source` | order_source | NO | `ONE_TIME` or `SUBSCRIPTION` |
| `channel` | order_channel | NO | `WEB` / `MOBILE` / `ADMIN` / `SYSTEM` |
| `subscription_id` | UUID | YES | → `subscriptions.id` `ON DELETE SET NULL` |
| `subscription_delivery_id` | UUID | YES | → `subscription_deliveries.id` `ON DELETE SET NULL` |
| `delivery_zone_id` | UUID | NO | → `delivery_zones.id` `ON DELETE RESTRICT` |
| `delivery_slot_id` | UUID | NO | → `delivery_slots.id` `ON DELETE RESTRICT` |
| `service_date` | DATE | NO | Delivery date |
| `slot_start_time` / `slot_end_time` | TIME | NO | **Snapshot** of the slot window |
| `slot_name_snapshot` | TEXT | NO | **Snapshot** — `Morning (06:00–08:00)` |
| `address_id` | UUID | YES | → `addresses.id` `ON DELETE RESTRICT` |
| `address_snapshot` | JSONB | NO | **Full address as delivered to** |
| `customer_name_snapshot` | TEXT | NO | |
| `customer_phone_snapshot` | TEXT | NO | |
| `subtotal_paise` | BIGINT | NO | Sum of line totals before order-level discount |
| `discount_paise` | BIGINT | NO | Default 0 |
| `delivery_fee_paise` | BIGINT | NO | Default 0 |
| `tax_paise` | BIGINT | NO | Default 0 |
| `total_paise` | BIGINT | NO | `CHECK (total_paise >= 0)` |
| `coupon_code` | TEXT | YES | Snapshot of the code used (P2) |
| `payment_method` | payment_method | NO | `COD` at MVP |
| `payment_status` | payment_status | NO | Denormalised from `payments` for fast filtering |
| `customer_note` | TEXT | YES | |
| `internal_note` | TEXT | YES | Admin only |
| `cancelled_at` | TIMESTAMPTZ | YES | |
| `cancelled_by_type` | cancel_actor | YES | |
| `cancelled_by_user_id` | UUID | YES | |
| `cancellation_reason` | TEXT | YES | |
| `confirmed_at` / `prepared_at` / `dispatched_at` / `delivered_at` | TIMESTAMPTZ | YES | Milestone timestamps for SLA reporting |
| `placed_at` | TIMESTAMPTZ | NO | Default `now()` |
| `created_at` / `updated_at` | TIMESTAMPTZ | NO | |

**CHECK:** `total_paise = subtotal_paise - discount_paise + delivery_fee_paise + tax_paise`.
**Partial UNIQUE:** `(subscription_delivery_id) WHERE subscription_delivery_id IS NOT NULL`
← **this single constraint is what makes duplicate subscription orders impossible.** Even if
the scheduler runs twice concurrently, the second insert fails (BR-S9).
**CHECK:** `(source='SUBSCRIPTION') = (subscription_id IS NOT NULL)`.

**Indexes:**
`(customer_profile_id, placed_at DESC)`, `(status, service_date)`,
`(service_date, delivery_slot_id, status)` ← the ops dashboard and prep-list query,
`(subscription_id)`, `(order_number)`, `(payment_status) WHERE payment_status='DUE'`.

**`order_number` generation:** `HL-{YYYY}-{7-digit zero-padded}` from a Postgres sequence per
business per year. A sequence, not `count(*)+1`, because the latter races and reuses numbers
after cancellation.

### 7.4 `order_items`

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | UUID | NO | PK |
| `order_id` | UUID | NO | → `orders.id` `ON DELETE CASCADE` |
| `variant_id` | UUID | YES | → `product_variants.id` `ON DELETE RESTRICT` |
| `combo_id` | UUID | YES | → `combos.id` `ON DELETE RESTRICT` |
| `parent_item_id` | UUID | YES | → `order_items.id`; set on exploded combo components |
| `product_name_snapshot` | TEXT | NO | |
| `variant_name_snapshot` | TEXT | YES | |
| `sku_snapshot` | TEXT | YES | |
| `image_url_snapshot` | TEXT | YES | |
| `unit` / `unit_value` | TEXT / NUMERIC | YES | Snapshot |
| `quantity` | INTEGER | NO | `CHECK (quantity > 0)` |
| `unit_price_paise` | BIGINT | NO | Price actually charged per unit |
| `mrp_paise` | BIGINT | YES | Snapshot, for "you saved" display |
| `discount_paise` | BIGINT | NO | Default 0 |
| `tax_rate_bps` | INTEGER | NO | Snapshot |
| `tax_paise` | BIGINT | NO | Default 0 |
| `line_total_paise` | BIGINT | NO | `quantity × unit_price − discount + tax` |
| `is_component` | BOOLEAN | NO | `true` for exploded combo components |
| `fulfilment_status` | TEXT | YES | P2 — per-line partial fulfilment |
| `created_at` | TIMESTAMPTZ | NO | |

**CHECK:** exactly one of `variant_id` / `combo_id` is non-null.
**Combo representation:** a combo produces one **priced parent row** (`combo_id` set,
`is_component=false`) plus N **zero-priced component rows** (`variant_id` set,
`is_component=true`, `parent_item_id` = parent). Only the parent carries money; only the
components drive inventory and prep. `subtotal_paise` sums rows where `is_component=false`.
This is what keeps combo money and combo logistics from fighting each other (doc 12).

### 7.5 `order_status_history`
Append-only. Every transition, who caused it, and why.

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | UUID | NO | PK |
| `order_id` | UUID | NO | → `orders.id` `ON DELETE CASCADE` |
| `from_status` | order_status | YES | NULL for the initial row |
| `to_status` | order_status | NO | |
| `actor_type` | TEXT | NO | `CUSTOMER` / `ADMIN` / `SYSTEM` |
| `actor_user_id` | UUID | YES | |
| `reason` | TEXT | YES | |
| `metadata` | JSONB | YES | |
| `created_at` | TIMESTAMPTZ | NO | |

**Index:** `(order_id, created_at)`.

### 7.6 `idempotency_keys`
Makes retries safe on every unsafe endpoint (BR-K7).

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | UUID | NO | PK |
| `key` | TEXT | NO | Client-supplied `Idempotency-Key` |
| `user_id` | UUID | NO | Scoped per user so keys cannot collide across accounts |
| `endpoint` | TEXT | NO | `POST /v1/orders` |
| `request_hash` | TEXT | NO | SHA-256 of the canonical body |
| `status` | TEXT | NO | `IN_PROGRESS` / `COMPLETED` / `FAILED` |
| `response_status` | INTEGER | YES | Replayed HTTP status |
| `response_body` | JSONB | YES | Replayed body |
| `resource_id` | UUID | YES | Created resource, for convenience |
| `expires_at` | TIMESTAMPTZ | NO | `now() + 24h` |
| `created_at` / `updated_at` | TIMESTAMPTZ | NO | |

**UNIQUE** `(user_id, endpoint, key)`.
Replaying the same key with a *different* body returns `422 IDEMPOTENCY_KEY_REUSED` — a
silent wrong answer would be worse than an error.

## 8. Subscription

Full engine in [11-SUBSCRIPTION-ENGINE.md](11-SUBSCRIPTION-ENGINE.md). The four-table split
below is deliberate and is the core of the design: a **plan** is the offer, a **subscription**
is the customer's contract, a **subscription_item** is what is delivered each time, and a
**subscription_delivery** is one dated occurrence which may or may not become an order.

### 8.1 `subscription_plans`
Admin-authored offer. A customer never edits a plan; they edit their subscription.

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | UUID | NO | PK |
| `name` | TEXT | NO | `Daily Fruit Chaat` |
| `slug` | CITEXT | NO | Partial-unique |
| `description` | TEXT | YES | |
| `image_url` | TEXT | YES | |
| `frequency_type` | frequency_type | NO | `DAILY` / `WEEKLY` / `CUSTOM_DAYS` / `ALTERNATE_DAYS` / `MONTHLY` |
| `allowed_days` | SMALLINT[] | YES | Constrains customer choice; NULL = any day |
| `default_days` | SMALLINT[] | YES | Preselected in the UI |
| `discount_type` | discount_type | YES | Discount vs one-time price |
| `discount_value` | INTEGER | YES | bps or paise |
| `min_duration_days` | INTEGER | YES | Commitment floor (BR-S12) |
| `max_duration_days` | INTEGER | YES | |
| `max_pause_days_per_month` | INTEGER | YES | Default from settings |
| `max_skips_per_month` | INTEGER | YES | |
| `pause_notice_hours` | INTEGER | NO | Default 0; hours before cutoff a pause must land |
| `cancellation_notice_hours` | INTEGER | NO | Default 0 |
| `allow_slot_change` | BOOLEAN | NO | Default `true` |
| `allow_quantity_change` | BOOLEAN | NO | Default `true` |
| `allowed_slot_ids` | UUID[] | YES | NULL = any active slot |
| `status` | product_status | NO | |
| `is_featured` | BOOLEAN | NO | |
| `display_order` | INTEGER | NO | |
| `deleted_at` | TIMESTAMPTZ | YES | |
| `created_at` / `updated_at` / `created_by` / `updated_by` | | | |

**Plan contents** are defined by `subscription_plan_items`
(`plan_id`, `variant_id` XOR `combo_id`, `quantity`, `is_quantity_editable`), UNIQUE per
`(plan_id, variant_id)` / `(plan_id, combo_id)`.

### 8.2 `subscriptions`
The customer's contract.

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | UUID | NO | PK |
| `subscription_number` | TEXT | NO | **UNIQUE**, `SUB-2026-0000412` |
| `customer_profile_id` | UUID | NO | → `customer_profiles.id` `ON DELETE RESTRICT` |
| `subscription_plan_id` | UUID | YES | → `subscription_plans.id` `ON DELETE RESTRICT`; NULL = ad-hoc |
| `status` | subscription_status | NO | |
| `frequency_type` | frequency_type | NO | **Snapshot** from the plan |
| `delivery_days` | SMALLINT[] | NO | Effective ISO weekdays |
| `interval_days` | INTEGER | YES | For `ALTERNATE_DAYS` / custom intervals |
| `delivery_slot_id` | UUID | NO | → `delivery_slots.id` `ON DELETE RESTRICT` |
| `address_id` | UUID | NO | → `addresses.id` `ON DELETE RESTRICT` |
| `delivery_zone_id` | UUID | NO | Resolved from the address |
| `start_date` | DATE | NO | |
| `end_date` | DATE | YES | NULL = open-ended |
| `next_delivery_date` | DATE | YES | Denormalised for listing and reminders |
| `last_delivery_date` | DATE | YES | |
| `paused_at` | TIMESTAMPTZ | YES | |
| `pause_until_date` | DATE | YES | Auto-resume on this date |
| `pause_reason` | TEXT | YES | |
| `resumed_at` | TIMESTAMPTZ | YES | |
| `cancelled_at` | TIMESTAMPTZ | YES | |
| `cancelled_by_type` | cancel_actor | YES | |
| `cancellation_reason` | TEXT | YES | |
| `price_per_delivery_paise` | BIGINT | NO | **Locked at subscription time** (BR-S7) |
| `delivery_fee_paise` | BIGINT | NO | Default 0 |
| `payment_method` | payment_method | NO | `COD` at MVP |
| `total_deliveries_count` | INTEGER | NO | Default 0 |
| `total_skipped_count` | INTEGER | NO | Default 0 |
| `generated_until_date` | DATE | YES | **Scheduler watermark** — how far ahead deliveries exist |
| `customer_note` | TEXT | YES | |
| `created_at` / `updated_at` | TIMESTAMPTZ | NO | |

**CHECK:** `end_date IS NULL OR end_date >= start_date`.
**CHECK:** `array_length(delivery_days,1) BETWEEN 1 AND 7`.
**Indexes:** `(customer_profile_id, status)`, `(status, next_delivery_date)` ← scheduler,
`(delivery_slot_id, status)`, `(subscription_number)`.

> `price_per_delivery_paise` is locked on the subscription rather than read live, because a
> customer who subscribed at ₹99 must not silently start paying ₹119. Price changes require
> an explicit, notified re-pricing action (BR-S7, EC-S6).
>
> `generated_until_date` is the idempotency watermark for the scheduler: generation is
> "extend from `generated_until_date` to horizon", not "create the next N", so a re-run
> creates nothing.

### 8.3 `subscription_items`
What this subscription delivers each time. Snapshot-priced.

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | UUID | NO | PK |
| `subscription_id` | UUID | NO | → `subscriptions.id` `ON DELETE CASCADE` |
| `variant_id` | UUID | YES | → `product_variants.id` `ON DELETE RESTRICT` |
| `combo_id` | UUID | YES | → `combos.id` `ON DELETE RESTRICT` |
| `quantity` | INTEGER | NO | `CHECK (quantity > 0)` |
| `unit_price_paise` | BIGINT | NO | Locked price |
| `product_name_snapshot` | TEXT | NO | |
| `variant_name_snapshot` | TEXT | YES | |
| `created_at` / `updated_at` | TIMESTAMPTZ | NO | |

**CHECK:** exactly one of `variant_id` / `combo_id`.
**UNIQUE** `(subscription_id, variant_id)` / `(subscription_id, combo_id)`.

### 8.4 `subscription_deliveries`
**The heart of the engine.** One row per scheduled occurrence. Created ahead of time by the
scheduler; later becomes an order, is skipped, or is cancelled.

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | UUID | NO | PK |
| `subscription_id` | UUID | NO | → `subscriptions.id` `ON DELETE RESTRICT` |
| `delivery_date` | DATE | NO | |
| `delivery_slot_id` | UUID | NO | Snapshot of the slot at generation time |
| `address_id` | UUID | NO | Snapshot of the address at generation time |
| `status` | sub_delivery_status | NO | `SCHEDULED` → `ORDER_CREATED` → `FULFILLED`, or `SKIPPED` / `CANCELLED` / `FAILED` |
| `order_id` | UUID | YES | → `orders.id` `ON DELETE SET NULL`; set on materialisation |
| `expected_total_paise` | BIGINT | NO | Snapshot of the price for this occurrence |
| `skipped_at` | TIMESTAMPTZ | YES | |
| `skipped_by_type` | cancel_actor | YES | |
| `skip_reason` | TEXT | YES | |
| `failure_reason` | TEXT | YES | Why materialisation failed (slot full, out of stock) |
| `materialised_at` | TIMESTAMPTZ | YES | |
| `reminder_sent_at` | TIMESTAMPTZ | YES | Prevents duplicate reminders |
| `created_at` / `updated_at` | TIMESTAMPTZ | NO | |

**UNIQUE `(subscription_id, delivery_date)`** ← **the constraint that makes duplicate
deliveries structurally impossible.** No amount of scheduler misbehaviour, concurrent
execution, retry or redeploy can produce two deliveries for one subscription on one date.
**Partial UNIQUE:** `(order_id) WHERE order_id IS NOT NULL` — one delivery per order.
**Indexes:** `(delivery_date, status)` ← materialisation job,
`(subscription_id, delivery_date DESC)` ← customer's upcoming list,
`(status) WHERE status='SCHEDULED'`.

### 8.5 `subscription_events`
Append-only lifecycle log for the subscription, mirroring `order_status_history`.
`id`, `subscription_id`, `event_type` (`CREATED`, `PAUSED`, `RESUMED`, `SKIPPED`,
`CANCELLED`, `QUANTITY_CHANGED`, `SLOT_CHANGED`, `ADDRESS_CHANGED`, `REPRICED`,
`EXPIRED`, `SUSPENDED`), `actor_type`, `actor_user_id`, `payload JSONB`, `created_at`.
Index `(subscription_id, created_at DESC)`.

## 9. Inventory

Behaviour in [13-INVENTORY-SYSTEM.md](13-INVENTORY-SYSTEM.md).

### 9.1 `inventory`
One row per (variant, business). Location-scoped from day one for future dark stores.

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | UUID | NO | PK |
| `variant_id` | UUID | NO | → `product_variants.id` `ON DELETE CASCADE` |
| `location_code` | TEXT | NO | Default `'MAIN'` |
| `quantity_on_hand` | INTEGER | NO | Default 0 |
| `quantity_reserved` | INTEGER | NO | Default 0 |
| `low_stock_threshold` | INTEGER | NO | Default 0 |
| `track_inventory` | BOOLEAN | NO | Default `true`; `false` = made to order, never blocks |
| `allow_backorder` | BOOLEAN | NO | Default `false` |
| `last_counted_at` | TIMESTAMPTZ | YES | |
| `created_at` / `updated_at` | TIMESTAMPTZ | NO | |

**UNIQUE** `(variant_id, location_code)`.
**CHECK:** `quantity_reserved >= 0`, `quantity_on_hand >= 0`.
**CHECK:** `quantity_reserved <= quantity_on_hand OR allow_backorder`.
`quantity_available` is **computed, never stored**: `quantity_on_hand - quantity_reserved`.
Storing it would create a third number that can disagree with the other two.

### 9.2 `inventory_movements`
Append-only ledger. Every change to `inventory` writes a movement in the same transaction;
the sum of movements must equal `quantity_on_hand` (verified by a nightly reconciliation).

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | UUID | NO | PK |
| `inventory_id` | UUID | NO | → `inventory.id` `ON DELETE RESTRICT` |
| `variant_id` | UUID | NO | Denormalised for reporting |
| `reason` | inventory_reason | NO | |
| `quantity_delta` | INTEGER | NO | Signed; `CHECK (quantity_delta <> 0)` |
| `quantity_after` | INTEGER | NO | On-hand after this movement — makes the ledger auditable |
| `reserved_delta` | INTEGER | NO | Default 0 |
| `reference_type` | TEXT | YES | `order`, `subscription_delivery`, `stock_take` |
| `reference_id` | UUID | YES | |
| `note` | TEXT | YES | |
| `actor_user_id` | UUID | YES | |
| `created_at` | TIMESTAMPTZ | NO | |

**Indexes:** `(variant_id, created_at DESC)`, `(reference_type, reference_id)`,
BRIN on `created_at`.

### 9.3 Future: `inventory_batches` (P2, documented now)
Fresh food is perishable, so the model is designed now and built later:
`id`, `inventory_id`, `batch_code`, `prepared_at`, `best_before_at`,
`quantity_received`, `quantity_remaining`, `cost_per_unit_paise`, `supplier`, `status`.
`inventory_movements` gains a nullable `batch_id`. Consumption is FEFO (first-expiring,
first-out). Nothing in the MVP schema blocks this: `inventory` stays the aggregate and
batches become its detail.

## 10. Payment

Gateway-ready abstraction, documented in
[19-PAYMENT-ARCHITECTURE.md](19-PAYMENT-ARCHITECTURE.md). These tables exist **at MVP** with
COD rows, so that adding Razorpay is configuration plus an adapter, not a migration.

### 10.1 `payments`
One row per order representing the money owed and its settlement state.

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | UUID | NO | PK |
| `order_id` | UUID | NO | → `orders.id` `ON DELETE RESTRICT`, **UNIQUE** |
| `method` | payment_method | NO | |
| `status` | payment_status | NO | COD starts at `DUE` |
| `amount_paise` | BIGINT | NO | |
| `amount_paid_paise` | BIGINT | NO | Default 0 |
| `amount_refunded_paise` | BIGINT | NO | Default 0 |
| `currency` | TEXT | NO | `INR` |
| `provider` | TEXT | YES | `COD` / `RAZORPAY` / `STRIPE` |
| `provider_payment_id` | TEXT | YES | |
| `paid_at` | TIMESTAMPTZ | YES | For COD, set when the rider settles |
| `collected_by_user_id` | UUID | YES | Which staff member took the cash |
| `failure_reason` | TEXT | YES | |
| `metadata` | JSONB | YES | Never store raw card or UPI credentials |
| `created_at` / `updated_at` | TIMESTAMPTZ | NO | |

**CHECK:** `amount_paid_paise <= amount_paise`, `amount_refunded_paise <= amount_paid_paise`.

### 10.2 `payment_attempts`
Each gateway interaction. At MVP there is one `COD` attempt per payment; later there may be
several per payment (failed UPI, then a successful card).
`id`, `payment_id`, `provider`, `provider_order_id`, `provider_payment_id`, `status`,
`amount_paise`, `error_code`, `error_message`, `raw_response JSONB` (redacted),
`created_at`, `updated_at`. Index `(payment_id, created_at DESC)`.

### 10.3 `refunds`
`id`, `payment_id`, `order_id`, `amount_paise`, `reason`, `status refund_status`,
`provider_refund_id`, `initiated_by_user_id`, `processed_at`, `created_at`, `updated_at`.
**CHECK:** sum of completed refunds ≤ `payments.amount_paid_paise` (enforced in service).

### 10.4 `payment_webhook_events`
Signature-verified inbound gateway callbacks, stored before processing so a replay or an
out-of-order webhook is safe.
`id`, `provider`, `event_id` (**UNIQUE** per provider — the replay guard), `event_type`,
`payload JSONB`, `signature_verified BOOLEAN`, `processed_at`, `processing_error`,
`received_at`.

## 11. Engagement

### 11.1 `notification_outbox`
Transactional outbox: domain events are written in the **same transaction** as the business
change, then dispatched asynchronously. This is what guarantees "order placed ⇒ email
eventually sent", without making email failure roll back an order (doc 18).

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | UUID | NO | PK |
| `event_type` | TEXT | NO | `ORDER_PLACED`, `SUBSCRIPTION_PAUSED` |
| `aggregate_type` | TEXT | NO | `order`, `subscription` |
| `aggregate_id` | UUID | NO | |
| `payload` | JSONB | NO | Everything a channel needs; no live lookups required |
| `dedupe_key` | TEXT | YES | **UNIQUE** when present — prevents double sends |
| `status` | outbox_status | NO | `PENDING` → `PROCESSING` → `SENT` / `FAILED` / `DEAD` |
| `attempts` | INTEGER | NO | Default 0 |
| `next_attempt_at` | TIMESTAMPTZ | NO | Exponential backoff |
| `last_error` | TEXT | YES | |
| `available_at` | TIMESTAMPTZ | NO | Enables scheduled sends (reminders) |
| `processed_at` | TIMESTAMPTZ | YES | |
| `created_at` | TIMESTAMPTZ | NO | |

**Index:** `(status, next_attempt_at) WHERE status IN ('PENDING','FAILED')`.
Dispatch claims rows with `FOR UPDATE SKIP LOCKED` so multiple workers never collide.

### 11.2 `notifications`
The customer-visible in-app feed.
`id`, `user_id`, `type`, `title`, `body`, `action_url`, `image_url`, `data JSONB`,
`read_at`, `created_at`. Index `(user_id, created_at DESC)`,
`(user_id) WHERE read_at IS NULL`.

### 11.3 `notification_logs`
Per-channel delivery record for support and debugging.
`id`, `outbox_id`, `user_id`, `channel notification_channel`, `recipient` (redacted in
exports), `template_key`, `provider`, `provider_message_id`, `status`, `error`,
`sent_at`, `delivered_at`, `opened_at`, `created_at`.
Index `(user_id, created_at DESC)`, `(outbox_id)`, `(provider_message_id)`.

### 11.4 `notification_preferences` (P2 schema, seeded at MVP)
`id`, `user_id`, `channel`, `category` (`TRANSACTIONAL` / `REMINDER` / `MARKETING`),
`is_enabled`. **UNIQUE** `(user_id, channel, category)`.
Transactional notifications are not opt-out-able; marketing requires explicit opt-in.

### 11.5 `favorites`
`id`, `customer_profile_id`, `product_id` XOR `combo_id`, `created_at`.
**UNIQUE** `(customer_profile_id, product_id)` / `(customer_profile_id, combo_id)`.
Hard delete on un-favourite.

### 11.6 `reviews` (P2, schema defined now)
`id`, `customer_profile_id`, `product_id`, `order_id` (**verified purchase** proof),
`rating SMALLINT CHECK (rating BETWEEN 1 AND 5)`, `title`, `body`,
`status` (`PENDING` / `APPROVED` / `REJECTED`), `moderated_by`, `moderated_at`,
`created_at`, `updated_at`.
**UNIQUE** `(customer_profile_id, product_id, order_id)` — one review per purchase.

## 12. Promotions (P2, schema defined now so order code is written against it)

`coupons`: `id`, `code CITEXT UNIQUE`, `description`, `discount_type`, `discount_value`,
`max_discount_paise`, `min_order_value_paise`, `applies_to` (`ALL`/`CATEGORY`/`PRODUCT`/`COMBO`/`SUBSCRIPTION`),
`applies_to_ids UUID[]`, `first_order_only BOOLEAN`, `usage_limit_total INTEGER`,
`usage_limit_per_customer INTEGER`, `used_count INTEGER`, `valid_from`, `valid_until`,
`is_active`, `created_by`, timestamps.

`coupon_redemptions`: `id`, `coupon_id`, `customer_profile_id`, `order_id`,
`discount_applied_paise`, `created_at`. **UNIQUE** `(coupon_id, order_id)`.
Per-customer limits are enforced by counting redemptions inside the order transaction.

`orders` already carries `coupon_code` and `discount_paise`, so enabling coupons adds a
validation step, not a schema change.

## 13. Indexing summary — the queries that matter

| # | Query | Index |
|---|---|---|
| 1 | Customer's order list | `orders (customer_profile_id, placed_at DESC)` |
| 2 | Today's prep list by slot | `orders (service_date, delivery_slot_id, status)` |
| 3 | Slot availability at checkout | `slot_capacity (delivery_slot_id, delivery_zone_id, service_date)` UNIQUE |
| 4 | Deliveries to materialise | `subscription_deliveries (delivery_date, status)` |
| 5 | Customer's upcoming deliveries | `subscription_deliveries (subscription_id, delivery_date DESC)` |
| 6 | Catalogue by category | `products (category_id, status)` |
| 7 | Text search | `products GIN(search_vector)` + `pg_trgm GIN(name)` |
| 8 | Dietary filter | `products GIN(dietary_tags)` |
| 9 | Outbox dispatch | `notification_outbox (status, next_attempt_at)` partial |
| 10 | Audit by resource | `audit_logs (resource_type, resource_id, created_at DESC)` |
| 11 | Serviceability lookup | `zone_pincodes (business_id, pincode)` UNIQUE |
| 12 | Unread notifications badge | `notifications (user_id) WHERE read_at IS NULL` |
| 13 | Low-stock dashboard | `inventory ((quantity_on_hand - quantity_reserved))` expression index |
| 14 | Subscriptions due for generation | `subscriptions (status, next_delivery_date)` |

## 14. Transaction boundaries

| Operation | Isolation | Locks | Rolls back |
|---|---|---|---|
| Place order | `READ COMMITTED` | `FOR UPDATE` on `slot_capacity`, then on `inventory` rows ordered by `variant_id` | Order, items, status, capacity increment, reservations, payment, outbox |
| Cancel order | `READ COMMITTED` | `FOR UPDATE` on order, capacity, inventory | Status, capacity decrement, reservation release |
| Materialise subscription delivery | `READ COMMITTED` | `FOR UPDATE` on delivery row, then capacity | Delivery status, order creation |
| Adjust stock | `READ COMMITTED` | `FOR UPDATE` on inventory row | Inventory + movement |
| Generate deliveries | `READ COMMITTED` | Advisory lock per subscription | Deliveries + watermark |

**Lock ordering rule:** always `slot_capacity` → `inventory` (ascending `variant_id`) →
`orders`. A fixed global order is what prevents deadlocks between concurrent checkouts.
Serializable isolation is deliberately avoided in favour of explicit row locks: it gives the
same guarantee here with predictable behaviour under load rather than serialisation failures
on the checkout path.

## 15. Data retention

| Data | Retention | Then |
|---|---|---|
| `orders`, `order_items`, `payments` | Indefinite | Financial record |
| `audit_logs` | 24 months hot | Archive to R2 as Parquet |
| `notification_logs` | 6 months | Delete |
| `notification_outbox` (SENT) | 30 days | Delete |
| `idempotency_keys` | 24 hours | Delete |
| `carts` inactive | 30 days | Delete |
| `slot_capacity` past dates | 90 days | Delete |
| `inventory_movements` | 24 months hot | Archive |
| Customer PII after deletion request | 30-day grace | Anonymise: orders retained with a tombstoned customer reference |
