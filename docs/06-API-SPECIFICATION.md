# 06 — API Specification

Base URL: `https://api.maindomain.com`
All endpoints are versioned: `/v1/...`
Machine-readable contract: `GET /v1/openapi.json` (generated from the Zod schemas in
`packages/contracts` — it cannot drift from the implementation).

## 1. Conventions

### 1.1 Audience prefixes

| Prefix | Audience | Auth |
|---|---|---|
| `/v1/public/*` | Anyone (marketing site, logged-out app) | None |
| `/v1/me/*` | Authenticated customer | Firebase **customer** ID token |
| `/v1/admin/*` | Authenticated staff | Firebase **admin** ID token + permission |
| `/v1/internal/*` | Worker and cron only | Service token, not routable from the internet |
| `/v1/webhooks/*` | Third parties | Signature verification, no session |

Splitting by audience rather than by resource means authorization is applied by prefix in
middleware and cannot be forgotten on a new route. A missing guard is a 500 at boot (the
route registry asserts every route declares an audience), not a silent hole in production.

### 1.2 Request headers

| Header | When | Notes |
|---|---|---|
| `Authorization: Bearer <firebase-id-token>` | Authenticated routes | Verified per request |
| `Content-Type: application/json` | Body requests | Only JSON is accepted |
| `Idempotency-Key: <uuid>` | **Required** on `POST /v1/me/orders`, `POST /v1/me/subscriptions`, all payment mutations | 24h window |
| `X-Request-Id` | Optional | Echoed back; generated if absent |
| `X-Client` | Recommended | `web-customer/1.4.2`, `android/2.0.0` — drives client-version gating later |
| `Accept-Language` | Optional | Reserved for future localisation |

### 1.3 Response envelope

Success responses return the resource directly (no wrapper) so generated clients are clean.
Collections are wrapped for pagination metadata:

```json
{
  "data": [ { "id": "01935f...", "name": "Fruit Chaat Bowl" } ],
  "pagination": {
    "limit": 20,
    "next_cursor": "eyJpZCI6IjAxOTM1Zi4uLiJ9",
    "has_more": true
  }
}
```

**Cursor pagination everywhere**, not offset. Offset pagination skips or repeats rows when
the underlying set changes between pages — unacceptable on an order list that is actively
being written. The cursor is an opaque base64 of the sort key plus id.

### 1.4 Error format

```json
{
  "error": {
    "code": "SLOT_CAPACITY_EXCEEDED",
    "message": "This delivery slot is fully booked.",
    "details": [
      { "field": "delivery_slot_id", "issue": "Slot is full for 2026-09-22" }
    ],
    "request_id": "01935f7c-8a1b-7def-9c3e-0242ac120002"
  }
}
```

- `message` is safe to show a customer. Internal detail never leaks into it.
- `code` is a stable machine identifier; clients branch on `code`, never on `message`.
- The full catalogue lives in `packages/contracts/src/errors.ts` and is surfaced in OpenAPI.

### 1.5 Status codes

| Code | Used for |
|---|---|
| 200 | Successful read or update |
| 201 | Resource created |
| 202 | Accepted for async processing |
| 204 | Successful delete with no body |
| 400 | Malformed request |
| 401 | Missing, expired or invalid token |
| 403 | Authenticated but not permitted (or account suspended) |
| 404 | Not found, **or** found but not yours (see §1.6) |
| 409 | State conflict — order not cancellable, slot full, duplicate resource |
| 410 | Gone — cart item references a deleted product |
| 422 | Semantically invalid — validation failure, idempotency key reused with a different body |
| 429 | Rate limited; `Retry-After` header present |
| 500 | Unhandled server error (logged with `request_id`) |
| 503 | Dependency unavailable (database, Firebase) |

### 1.6 Ownership and 404-over-403

For customer-scoped resources, a resource belonging to another customer returns **404, not
403**. A 403 confirms that the id exists, which is an enumeration oracle. Every
`/v1/me/*` query filters by the authenticated `customer_profile_id` in the `WHERE` clause —
ownership is enforced in the query, not by a post-fetch `if` that someone can forget.

### 1.7 Standard query parameters

`limit` (default 20, max 100) · `cursor` · `sort` (`field:asc|desc` from an allow-list) ·
`q` (search) · `include` (comma-separated relation expansion from an allow-list)

Sort and include values are validated against an explicit allow-list per endpoint — never
passed through to the ORM — which removes a whole class of injection and accidental
full-table-scan bugs.

### 1.8 Money shape

```json
{ "amount_paise": 14950, "currency": "INR", "display": "₹149.50" }
```
Always this object, never a bare number and never a string. The client never does currency
arithmetic; `display` is computed once on the server.

### 1.9 Rate limits

| Scope | Limit |
|---|---|
| Public reads (per IP) | 120 / min |
| Authenticated reads (per user) | 300 / min |
| Authenticated writes (per user) | 60 / min |
| `POST /v1/me/orders` (per user) | 10 / min |
| Auth session exchange (per IP) | 20 / 15 min |
| Admin writes (per user) | 120 / min |

Enforced twice: coarsely at Cloudflare per IP, precisely in the API per user (doc 23).

## 2. Health and meta

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/v1/health` | None | Liveness. `{ status, version, uptime_s }` |
| GET | `/v1/health/ready` | None | Readiness — checks DB connectivity |
| GET | `/v1/openapi.json` | None | OpenAPI 3.1 document |
| GET | `/v1/public/config` | None | Public settings: currency, support contact, app minimum version, feature flags |

## 3. Authentication

Firebase performs authentication in the client SDK; the API **verifies** the resulting ID
token and manages our side of the identity. Flows in
[07-AUTHENTICATION-AUTHORIZATION.md](07-AUTHENTICATION-AUTHORIZATION.md).

### `POST /v1/auth/session`
Exchange a verified Firebase ID token for our application user, creating it on first use.

**Auth:** Firebase ID token (customer or admin project).
**Body:** `{ "device_id"?: string, "fcm_token"?: string }`
**Responses**

| Code | Meaning |
|---|---|
| 200 | Existing user returned |
| 201 | New user + profile provisioned |
| 401 | Token invalid, expired, or from the wrong Firebase project |
| 403 | `ACCOUNT_SUSPENDED` |

```json
{
  "user": { "id": "0193...", "user_type": "CUSTOMER", "phone": "+919876543210",
            "status": "ACTIVE" },
  "profile": { "id": "0193...", "first_name": "Priya", "display_name": "Priya",
               "default_address_id": null, "is_profile_complete": false },
  "permissions": []
}
```
For admins, `permissions` contains the resolved permission keys so the panel can hide
what the user cannot do. The API still re-checks on every request — the client list is a
UX affordance, never a security control.

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/v1/auth/session` | Firebase token | Provision or fetch the app user |
| POST | `/v1/auth/logout` | Customer/Admin | Clear the admin session cookie; record `last_logout_at` |
| GET | `/v1/auth/me` | Customer/Admin | Current user, profile and permissions |
| POST | `/v1/admin/auth/session` | Firebase admin token | Sets the `__Host-admin_session` cookie (doc 07 §6) |

## 4. Public catalogue

Cacheable, unauthenticated, used by the marketing site and the logged-out app.
All send `Cache-Control: public, s-maxage=60, stale-while-revalidate=300` and an `ETag`.

| Method | Path | Description |
|---|---|---|
| GET | `/v1/public/categories` | Active categories as a 2-level tree |
| GET | `/v1/public/categories/:slug` | One category with SEO metadata |
| GET | `/v1/public/products` | Paginated product list |
| GET | `/v1/public/products/:slug` | Full product detail |
| GET | `/v1/public/combos` | Active combos |
| GET | `/v1/public/combos/:slug` | Combo detail with components |
| GET | `/v1/public/subscription-plans` | Active plans |
| GET | `/v1/public/subscription-plans/:slug` | Plan detail |
| GET | `/v1/public/search` | Product + combo search |
| GET | `/v1/public/serviceability?pincode=201301` | Is this pincode serviceable (city + pincode gate, PHASE 01) |
| GET | `/v1/public/cities` | Serviceable and coming-soon cities (PHASE 01) |
| GET | `/v1/public/delivery-slots?pincode=560076` | Publicly visible slot windows |
| GET | `/v1/public/content/:key` | CMS block (FAQ, policy) — P2 |

### `GET /v1/public/products`

**Query:** `category` (slug) · `tags` (csv) · `dietary` (csv) · `min_price_paise` ·
`max_price_paise` · `is_featured` · `is_bestseller` · `is_subscribable` ·
`sort` ∈ `popularity|price:asc|price:desc|newest|name` · `limit` · `cursor`

```json
{
  "data": [{
    "id": "0193...", "slug": "fruit-chaat-bowl", "name": "Fruit Chaat Bowl",
    "short_description": "Seasonal fruit, chaat masala, fresh lime.",
    "category": { "id": "0193...", "slug": "fruit-chaat", "name": "Fruit Chaat" },
    "primary_image": { "url": "https://cdn.../chaat.jpg", "alt_text": "Fruit chaat bowl",
                       "width": 1200, "height": 1200, "blur_data_url": "data:image/..." },
    "default_variant": {
      "id": "0193...", "name": "250g", "sku": "FCB-250",
      "price": { "amount_paise": 14900, "currency": "INR", "display": "₹149.00" },
      "mrp":   { "amount_paise": 17900, "currency": "INR", "display": "₹179.00" },
      "discount_percent": 17,
      "availability": "AVAILABLE",
      "in_stock": true
    },
    "variant_count": 2,
    "dietary_tags": ["vegan", "no-added-sugar"],
    "is_subscribable": true,
    "badges": ["BESTSELLER"]
  }],
  "pagination": { "limit": 20, "next_cursor": "eyJ...", "has_more": true }
}
```

**Validation:** unknown `sort` → `422 INVALID_SORT_FIELD`; `min_price_paise > max_price_paise`
→ `422 INVALID_PRICE_RANGE`.
**Notes:** `cost_paise` is never serialised on a public or customer endpoint — it is excluded
at the DTO layer, not filtered in the route, so it cannot leak through a new endpoint.
`in_stock` is derived (`track_inventory=false` ⇒ always `true`).

### `GET /v1/public/products/:slug`
Adds `description`, all `variants`, all `images`, `ingredients`, `nutrition`, `allergens`,
`preparation_note`, `storage_note`, `shelf_life_hours`, `seo`, and `related_products`.
`404 PRODUCT_NOT_FOUND` when missing, inactive or soft-deleted.

### `GET /v1/public/search`
**Query:** `q` (required, 2–64 chars) · `type` ∈ `all|product|combo` · `limit`
MVP implementation: PostgreSQL `tsvector` ranked search, with `pg_trgm` similarity as a
fallback when full-text yields nothing (handles "chat" → "chaat"). Response includes
`match_type: "FULL_TEXT" | "FUZZY"` so the UI can say "showing results for…".
`400 SEARCH_QUERY_TOO_SHORT` under 2 characters.

### `GET /v1/public/serviceability`
```json
{
  "pincode": "560076", "is_serviceable": true,
  "zone": { "id": "0193...", "name": "South Bengaluru — Zone 1", "area_name": "HSR Layout",
            "delivery_fee": { "amount_paise": 2900, "currency":"INR", "display":"₹29.00" },
            "free_delivery_above": { "amount_paise": 39900, "currency":"INR", "display":"₹399.00" },
            "min_order_value": { "amount_paise": 19900, "currency":"INR", "display":"₹199.00" } }
}
```
Non-serviceable returns `200` with `is_serviceable: false` and a `waitlist_available` flag —
a 404 would be wrong: the question was answered successfully.

## 5. Customer — profile and addresses

| Method | Path | Description |
|---|---|---|
| GET | `/v1/me/profile` | Profile |
| PATCH | `/v1/me/profile` | Update name, email, DOB, marketing opt-in |
| DELETE | `/v1/me/account` | Request account deletion (P2) — 30-day grace |
| GET | `/v1/me/addresses` | Address book |
| POST | `/v1/me/addresses` | Create address |
| GET | `/v1/me/addresses/:id` | One address |
| PATCH | `/v1/me/addresses/:id` | Update |
| DELETE | `/v1/me/addresses/:id` | Soft delete |
| POST | `/v1/me/addresses/:id/default` | Set as default |

### `POST /v1/me/addresses`
```json
{
  "label": "Home", "recipient_name": "Priya Sharma", "recipient_phone": "+919876543210",
  "line1": "402, Green Meadows", "line2": "27th Main, HSR Layout Sector 2",
  "landmark": "Opposite BDA Complex", "city": "Bengaluru", "state": "Karnataka",
  "pincode": "560102", "latitude": 12.9101, "longitude": 77.6446,
  "delivery_instructions": "Ring the bell twice", "is_default": true
}
```
**Validation:** `pincode` matches `^[1-9][0-9]{5}$`; `recipient_phone` is E.164;
`line1` 3–120 chars; max 10 active addresses per customer.
**Behaviour:** `delivery_zone_id` is resolved server-side. An unserviceable pincode is
**still saved**, with `is_serviceable: false` in the response — the customer may be adding a
future address, and blocking the save would be hostile. Serviceability is enforced at
checkout, once, where it matters (BR-D1).
**Errors:** `422 INVALID_PINCODE`, `409 ADDRESS_LIMIT_REACHED`.
**Deletion:** an address used by an **active subscription** returns
`409 ADDRESS_IN_USE_BY_SUBSCRIPTION` listing the subscription numbers (EC-A2).

## 6. Cart

| Method | Path | Description |
|---|---|---|
| GET | `/v1/me/cart` | Current cart, fully re-priced |
| POST | `/v1/me/cart/items` | Add a variant or combo |
| PATCH | `/v1/me/cart/items/:id` | Change quantity |
| DELETE | `/v1/me/cart/items/:id` | Remove a line |
| DELETE | `/v1/me/cart` | Empty the cart |
| POST | `/v1/me/cart/merge` | Merge a guest cart after login |
| POST | `/v1/me/cart/validate` | Pre-checkout validation |
| POST | `/v1/me/cart/reorder/:order_id` | Replace cart with a past order's lines |

### `GET /v1/me/cart`
Totals are **always recomputed** from live catalogue data — the cart stores no money (BR-K2).

```json
{
  "id": "0193...",
  "items": [{
    "id": "0193...", "type": "VARIANT", "quantity": 2,
    "variant": { "id": "0193...", "sku": "FCB-250", "name": "250g",
                 "product": { "id":"0193...", "slug":"fruit-chaat-bowl",
                              "name":"Fruit Chaat Bowl",
                              "image_url":"https://cdn.../chaat.jpg" } },
    "unit_price": { "amount_paise": 14900, "currency":"INR", "display":"₹149.00" },
    "line_total": { "amount_paise": 29800, "currency":"INR", "display":"₹298.00" },
    "is_available": true, "available_quantity": 12, "issues": []
  }],
  "summary": {
    "item_count": 2,
    "subtotal": { "amount_paise": 29800, "currency":"INR", "display":"₹298.00" },
    "discount": { "amount_paise": 0, "currency":"INR", "display":"₹0.00" },
    "delivery_fee": { "amount_paise": 2900, "currency":"INR", "display":"₹29.00" },
    "tax": { "amount_paise": 0, "currency":"INR", "display":"₹0.00" },
    "total": { "amount_paise": 32700, "currency":"INR", "display":"₹327.00" }
  },
  "delivery": { "address_id": null, "delivery_slot_id": null, "service_date": null },
  "issues": [
    { "code": "MIN_ORDER_NOT_MET", "message": "Add ₹1.00 more to place this order",
      "severity": "BLOCKING", "item_id": null }
  ]
}
```

`issues[]` is the single mechanism for surfacing every problem, at cart level and line level,
with `severity: BLOCKING | WARNING`. Checkout is disabled while any `BLOCKING` issue exists.
This means the UI renders one component for every failure mode instead of branching on error
codes, and a new rule is a new issue code rather than new UI.

**Issue codes:** `ITEM_UNAVAILABLE`, `ITEM_OUT_OF_STOCK`, `ITEM_QUANTITY_REDUCED`,
`ITEM_PRICE_CHANGED`, `MIN_ORDER_NOT_MET`, `ADDRESS_NOT_SERVICEABLE`, `SLOT_UNAVAILABLE`,
`SLOT_CUTOFF_PASSED`, `SLOT_FULL`, `MAX_QUANTITY_EXCEEDED`.

### `POST /v1/me/cart/items`
```json
{ "variant_id": "0193...", "quantity": 2 }
```
or `{ "combo_id": "0193...", "quantity": 1 }`. Exactly one of the two.
**Behaviour:** adding an existing line increments quantity (the unique index guarantees one
row per line). Quantity is clamped to `max_order_quantity` and to available stock, and the
response reports the clamp as a `WARNING` issue rather than failing.
**Errors:** `404 VARIANT_NOT_FOUND`, `409 ITEM_NOT_AVAILABLE`, `422 INVALID_QUANTITY`,
`400 AMBIGUOUS_CART_ITEM` (both ids supplied).

### `POST /v1/me/cart/merge`
```json
{ "items": [ { "variant_id": "0193...", "quantity": 1 } ] }
```
Server-side union: quantities are summed and clamped; unavailable guest items are dropped
and reported in `dropped_items[]`. Idempotent — merging the same payload twice does not
double the quantities, because the client clears local storage only after a 200 and the
server dedupes by line.

### `POST /v1/me/cart/validate`
The dry run of checkout. Same validation as `POST /v1/me/orders` including slot capacity —
but it **takes no locks and reserves nothing**. Returns the final summary and `issues[]`.
Called when the user reaches the checkout screen and again before enabling "Place order".

## 7. Delivery slots (customer)

| Method | Path | Description |
|---|---|---|
| GET | `/v1/me/delivery-slots` | Bookable slots for an address over the horizon |
| GET | `/v1/me/delivery-slots/next-available` | The soonest bookable slot |

### `GET /v1/me/delivery-slots`
**Query:** `address_id` (required) · `from_date` · `days` (default 7, max 14)

```json
{
  "address_id": "0193...", "zone": { "id":"0193...", "name":"South Bengaluru — Zone 1" },
  "timezone": "Asia/Kolkata",
  "days": [{
    "service_date": "2026-09-21",
    "is_holiday": false,
    "slots": [
      { "delivery_slot_id":"0193...", "code":"MORNING", "name":"Morning",
        "window":"06:00 – 08:00", "start_time":"06:00", "end_time":"08:00",
        "cutoff_at":"2026-09-20T16:30:00Z", "is_available":true,
        "remaining_capacity":34, "is_nearly_full":false,
        "delivery_fee":{ "amount_paise":2900,"currency":"INR","display":"₹29.00" },
        "min_order_value":{ "amount_paise":19900,"currency":"INR","display":"₹199.00" },
        "unavailable_reason": null },
      { "delivery_slot_id":"0193...", "code":"EVENING", "name":"Evening",
        "window":"17:00 – 19:00", "is_available":false, "remaining_capacity":0,
        "unavailable_reason":"SLOT_FULL" }
    ]
  }]
}
```
`unavailable_reason` ∈ `CUTOFF_PASSED | SLOT_FULL | SLOT_BLOCKED | HOLIDAY |
NOT_AVAILABLE_ON_DAY | ZONE_NOT_SERVED | SLOT_INACTIVE`. Unavailable slots are returned
rather than hidden, so the UI can explain *why* — "fully booked" converts far better than a
slot that silently vanished. `cutoff_at` is an absolute UTC instant, computed server-side
from `cutoff_time` and `cutoff_days_before`, so no client ever does timezone maths.
`is_nearly_full` is true under 20% remaining — honest scarcity, driven by real data.

## 8. Orders (customer)

| Method | Path | Idempotent | Description |
|---|---|---|---|
| POST | `/v1/me/orders` | **Required** | Place an order from the cart |
| GET | `/v1/me/orders` | — | Order history |
| GET | `/v1/me/orders/:id` | — | Order detail with status history |
| POST | `/v1/me/orders/:id/cancel` | — | Cancel (rules apply) |
| GET | `/v1/me/orders/:id/track` | — | Lightweight status for polling |
| POST | `/v1/me/orders/:id/reorder` | — | Clone into cart |
| GET | `/v1/me/orders/:id/invoice` | — | Invoice PDF (P2) |

### `POST /v1/me/orders`
**Headers:** `Idempotency-Key: <uuid>` — **required**.
```json
{
  "address_id": "0193...",
  "delivery_slot_id": "0193...",
  "service_date": "2026-09-21",
  "payment_method": "COD",
  "customer_note": "Please ring the bell twice",
  "coupon_code": null,
  "expected_total_paise": 32700
}
```

`expected_total_paise` is a **client-side price assertion**. If the server-computed total
differs, the request fails with `409 PRICE_CHANGED` and returns both totals, and the UI
re-confirms with the customer. This is the only safe way to run an "order now" button
against a catalogue that admins edit during the day (BR-K6).

**Transaction** (doc 02 §6, doc 09 §4): lock capacity → validate → reserve stock → insert
order, items, status, payment, outbox → commit.

**Responses**

| Code | Error code | Cause |
|---|---|---|
| 201 | — | Order created |
| 200 | — | Idempotent replay of a completed request |
| 400 | `CART_EMPTY` | Nothing to order |
| 409 | `PRICE_CHANGED` | `expected_total_paise` mismatch |
| 409 | `SLOT_CAPACITY_EXCEEDED` | Slot filled between validation and submit |
| 409 | `SLOT_CUTOFF_PASSED` | Cutoff elapsed mid-checkout |
| 409 | `INSUFFICIENT_STOCK` | With per-item detail |
| 409 | `ITEM_NOT_AVAILABLE` | Item deactivated mid-checkout |
| 422 | `ADDRESS_NOT_SERVICEABLE` | Zone check failed |
| 422 | `MIN_ORDER_NOT_MET` | Below zone/slot minimum |
| 422 | `IDEMPOTENCY_KEY_REUSED` | Same key, different body |
| 429 | `RATE_LIMITED` | |

```json
{
  "id": "0193...", "order_number": "HL-2026-0001842", "status": "PENDING",
  "source": "ONE_TIME", "placed_at": "2026-09-20T11:42:07Z",
  "service_date": "2026-09-21",
  "slot": { "id":"0193...", "name":"Morning", "window":"06:00 – 08:00" },
  "delivery_address": { "recipient_name":"Priya Sharma", "line1":"402, Green Meadows",
                        "line2":"27th Main, HSR Layout Sector 2", "city":"Bengaluru",
                        "pincode":"560102" },
  "items": [ { "id":"0193...", "product_name":"Fruit Chaat Bowl", "variant_name":"250g",
               "quantity":2, "image_url":"https://cdn.../chaat.jpg",
               "unit_price":{"amount_paise":14900,"currency":"INR","display":"₹149.00"},
               "line_total":{"amount_paise":29800,"currency":"INR","display":"₹298.00"},
               "components": [] } ],
  "summary": { "subtotal": {"amount_paise":29800,"currency":"INR","display":"₹298.00"},
               "discount": {"amount_paise":0,"currency":"INR","display":"₹0.00"},
               "delivery_fee": {"amount_paise":2900,"currency":"INR","display":"₹29.00"},
               "tax": {"amount_paise":0,"currency":"INR","display":"₹0.00"},
               "total": {"amount_paise":32700,"currency":"INR","display":"₹327.00"} },
  "payment": { "method":"COD", "status":"DUE",
               "amount":{"amount_paise":32700,"currency":"INR","display":"₹327.00"} },
  "can_cancel": true,
  "cancel_deadline_at": "2026-09-20T16:30:00Z"
}
```

### `POST /v1/me/orders/:id/cancel`
**Body:** `{ "reason": "Changed my mind" }`
Allowed only while `status ∈ {PENDING, CONFIRMED}` **and** `now() < cutoff_at` (BR-O5).
Releases slot capacity and inventory reservation in one transaction.
**Errors:** `409 ORDER_NOT_CANCELLABLE` with `current_status` and `reason`;
`404 ORDER_NOT_FOUND`.

### `GET /v1/me/orders/:id/track`
Deliberately minimal for polling every 30s: `{ status, status_label, updated_at, eta_window,
history: [{ status, at }] }`. `Cache-Control: private, max-age=15`.
This is the MVP real-time mechanism (ADR-016).

## 9. Subscriptions (customer)

| Method | Path | Idempotent | Description |
|---|---|---|---|
| GET | `/v1/me/subscriptions` | — | List |
| POST | `/v1/me/subscriptions` | **Required** | Create |
| GET | `/v1/me/subscriptions/:id` | — | Detail |
| PATCH | `/v1/me/subscriptions/:id` | — | Change quantity, slot, address, end date |
| POST | `/v1/me/subscriptions/:id/pause` | — | Pause |
| POST | `/v1/me/subscriptions/:id/resume` | — | Resume |
| POST | `/v1/me/subscriptions/:id/cancel` | — | Cancel |
| GET | `/v1/me/subscriptions/:id/deliveries` | — | Deliveries (upcoming + past) |
| POST | `/v1/me/subscriptions/:id/deliveries/:deliveryId/skip` | — | Skip one |
| POST | `/v1/me/subscriptions/:id/deliveries/:deliveryId/unskip` | — | Undo a skip |
| GET | `/v1/me/deliveries/upcoming` | — | Across all subscriptions |
| GET | `/v1/me/subscriptions/:id/events` | — | Lifecycle log |

### `POST /v1/me/subscriptions`
```json
{
  "subscription_plan_id": "0193...",
  "items": [ { "variant_id": "0193...", "quantity": 1 } ],
  "delivery_days": [1,2,3,4,5],
  "delivery_slot_id": "0193...",
  "address_id": "0193...",
  "start_date": "2026-09-22",
  "end_date": null,
  "customer_note": null
}
```
**Validation:** `start_date` ≥ tomorrow and ≤ today + 60 days (BR-S2); `delivery_days` ⊆
`plan.allowed_days`; `delivery_slot_id` ∈ `plan.allowed_slot_ids`; items ⊆ plan items with
editable quantity; address serviceable; plan `ACTIVE`.
**Behaviour:** creates the subscription, snapshots prices, runs the generator inline for the
first horizon so `upcoming_deliveries` is populated immediately (an empty list after
subscribing reads as a failure), and emits `SUBSCRIPTION_CREATED`.
**Errors:** `422 INVALID_START_DATE`, `422 INVALID_DELIVERY_DAYS`, `422 SLOT_NOT_ALLOWED_BY_PLAN`,
`422 ADDRESS_NOT_SERVICEABLE`, `409 PLAN_INACTIVE`, `409 DUPLICATE_SUBSCRIPTION`.

```json
{
  "id":"0193...", "subscription_number":"SUB-2026-0000412", "status":"ACTIVE",
  "plan": { "id":"0193...", "name":"Daily Fruit Chaat", "slug":"daily-fruit-chaat" },
  "items": [{ "product_name":"Fruit Chaat Bowl","variant_name":"250g","quantity":1,
              "unit_price":{"amount_paise":12900,"currency":"INR","display":"₹129.00"} }],
  "price_per_delivery": {"amount_paise":12900,"currency":"INR","display":"₹129.00"},
  "savings_per_delivery": {"amount_paise":2000,"currency":"INR","display":"₹20.00"},
  "delivery_days":[1,2,3,4,5], "delivery_days_label":"Mon – Fri",
  "slot": {"id":"0193...","name":"Morning","window":"06:00 – 08:00"},
  "address": { "label":"Home","line1":"402, Green Meadows","pincode":"560102" },
  "start_date":"2026-09-22", "end_date":null, "next_delivery_date":"2026-09-22",
  "upcoming_deliveries":[
    {"id":"0193...","delivery_date":"2026-09-22","status":"SCHEDULED","can_skip":true,
     "skip_deadline_at":"2026-09-21T16:30:00Z"},
    {"id":"0193...","delivery_date":"2026-09-23","status":"SCHEDULED","can_skip":true}
  ],
  "rules": { "can_pause":true, "can_skip":true, "can_change_quantity":true,
             "can_change_slot":true, "can_cancel":true,
             "max_skips_per_month":8, "skips_used_this_month":0,
             "max_pause_days_per_month":15, "pause_days_used_this_month":0,
             "min_duration_days":null, "cancellation_notice_hours":12 }
}
```
The `rules` block is returned on every read so the client never hard-codes policy. Changing
a plan rule in admin changes the customer UI with no deploy — and, critically, the server
enforces the same rules it advertises.

### `POST /v1/me/subscriptions/:id/pause`
```json
{ "pause_from_date": "2026-10-01", "resume_on_date": "2026-10-10", "reason": "Travelling" }
```
`resume_on_date` may be null for an indefinite pause. Deliveries in the window that are
still `SCHEDULED` become `CANCELLED`; any already `ORDER_CREATED` are **not** touched — the
customer must cancel those orders explicitly, and the response says so in
`affected_orders[]` (EC-S1). This avoids the worst failure mode in subscription systems:
silently cancelling an order the kitchen has already committed to.
**Errors:** `409 SUBSCRIPTION_NOT_ACTIVE`, `422 PAUSE_LIMIT_EXCEEDED`,
`422 INVALID_PAUSE_WINDOW`, `422 PAUSE_NOTICE_TOO_SHORT`.

### `POST /v1/me/subscriptions/:id/deliveries/:deliveryId/skip`
Allowed only while `status='SCHEDULED'` and `now() < skip_deadline_at` (= that date's slot
cutoff). Once materialised into an order, the customer must cancel the order instead, and
the error says exactly that with the order number (BR-S5).
**Errors:** `409 DELIVERY_NOT_SKIPPABLE`, `409 SKIP_DEADLINE_PASSED`,
`422 SKIP_LIMIT_EXCEEDED`, `409 ALREADY_MATERIALISED` (includes `order_id`, `order_number`).

### `PATCH /v1/me/subscriptions/:id`
Changeable: `items[].quantity`, `delivery_slot_id`, `address_id`, `delivery_days`, `end_date`.
**Effective from the next un-materialised delivery.** Already-created orders are untouched.
The response returns `effective_from_date` so the UI can state it plainly.
Gated by the plan's `allow_quantity_change` / `allow_slot_change` flags.

## 10. Favourites and notifications

| Method | Path | Description |
|---|---|---|
| GET | `/v1/me/favorites` | List |
| POST | `/v1/me/favorites` | Add `{ product_id }` or `{ combo_id }` |
| DELETE | `/v1/me/favorites/:id` | Remove |
| GET | `/v1/me/notifications` | Feed, `unread_only` filter |
| POST | `/v1/me/notifications/:id/read` | Mark read |
| POST | `/v1/me/notifications/read-all` | Mark all read |
| GET | `/v1/me/notifications/unread-count` | Badge count |
| GET | `/v1/me/notification-preferences` | P2 |
| PATCH | `/v1/me/notification-preferences` | P2 |
| POST | `/v1/me/devices` | Register a push token (P3) |

## 11. Admin API

Every route requires a valid admin session **and** an explicit permission from
[08-RBAC-PERMISSIONS.md](08-RBAC-PERMISSIONS.md). The required permission is declared in the
route definition and appears in the generated OpenAPI, so the contract itself documents who
may call what. Every mutation writes an `audit_logs` row in the same transaction.

### 11.1 Dashboard and reports
| Method | Path | Permission |
|---|---|---|
| GET | `/v1/admin/dashboard/summary` | `dashboard:read` |
| GET | `/v1/admin/dashboard/slot-utilisation` | `dashboard:read` |
| GET | `/v1/admin/dashboard/order-status-breakdown` | `dashboard:read` |
| GET | `/v1/admin/reports/sales` | `reports:read` |
| GET | `/v1/admin/reports/products` | `reports:read` |
| GET | `/v1/admin/reports/subscriptions` | `reports:read` |
| GET | `/v1/admin/reports/customers` | `reports:read` |
| GET | `/v1/admin/reports/export` | `reports:export` |

### 11.2 Orders
| Method | Path | Permission |
|---|---|---|
| GET | `/v1/admin/orders` | `orders:read` |
| GET | `/v1/admin/orders/:id` | `orders:read` |
| POST | `/v1/admin/orders/:id/status` | `orders:update_status` |
| POST | `/v1/admin/orders/:id/cancel` | `orders:cancel` |
| PATCH | `/v1/admin/orders/:id` | `orders:update` (internal note, slot reassignment) |
| POST | `/v1/admin/orders/:id/payment/collect` | `payments:collect` (mark COD received) |
| POST | `/v1/admin/orders/bulk-status` | `orders:update_status` (max 100 ids) |
| GET | `/v1/admin/orders/prep-list` | `orders:read` — grouped by slot and variant |
| GET | `/v1/admin/orders/dispatch-manifest` | `orders:read` — grouped by slot and zone |

`POST /v1/admin/orders/:id/status` body: `{ "status": "PREPARING", "reason": null }`.
Rejected with `409 INVALID_STATUS_TRANSITION` (listing `allowed_transitions`) when the move
is not permitted by the state machine (doc 09). The machine is enforced in `core`, so the
admin UI, the bulk endpoint and any future mobile ops app all obey the same rules.

### 11.3 Catalogue
`GET|POST /v1/admin/categories` · `GET|PATCH|DELETE /v1/admin/categories/:id` ·
`POST /v1/admin/categories/reorder`
`GET|POST /v1/admin/products` · `GET|PATCH|DELETE /v1/admin/products/:id` ·
`POST /v1/admin/products/:id/publish` · `POST /v1/admin/products/:id/unpublish`
`GET|POST /v1/admin/products/:id/variants` · `PATCH|DELETE /v1/admin/variants/:id`
`POST /v1/admin/products/:id/images` (presign) · `POST /v1/admin/products/:id/images/confirm` ·
`PATCH|DELETE /v1/admin/images/:id` · `POST /v1/admin/products/:id/images/reorder`
`GET|POST /v1/admin/combos` · `GET|PATCH|DELETE /v1/admin/combos/:id`
Permissions: `catalog:read`, `catalog:create`, `catalog:update`, `catalog:delete`,
`catalog:publish`.

**Image upload is a two-step presign flow** (doc 23 §9): the API returns a short-lived R2
upload URL constrained by content type and size; the browser uploads directly; the client
confirms; the worker validates magic bytes and dimensions and flips `status` to `READY`.
Bytes never pass through the API.

### 11.4 Subscriptions
`GET /v1/admin/subscription-plans` · `POST` · `GET|PATCH|DELETE /:id` —
`subscriptions:manage_plans`
`GET /v1/admin/subscriptions` (filter by status, plan, slot, next delivery date) ·
`GET /:id` · `POST /:id/pause` · `POST /:id/resume` · `POST /:id/cancel` ·
`PATCH /:id` · `POST /:id/regenerate-deliveries` — `subscriptions:read|update|cancel`
`GET /v1/admin/subscription-deliveries` — the operational view by date and slot, including
`FAILED` deliveries needing intervention.

### 11.5 Customers
`GET /v1/admin/customers` · `GET /:id` · `GET /:id/orders` · `GET /:id/subscriptions` ·
`PATCH /:id` (internal notes) · `POST /:id/suspend` · `POST /:id/reactivate`
Permissions: `customers:read`, `customers:update`, `customers:suspend`.
Customer phone and email are **masked** (`+9198****3210`) for roles without
`customers:read_pii`; unmasking is itself an audited action (doc 23 §11).

### 11.6 Inventory
`GET /v1/admin/inventory` (filter `low_stock`, `out_of_stock`) ·
`GET /v1/admin/inventory/:variantId` · `POST /v1/admin/inventory/:variantId/adjust` ·
`POST /v1/admin/inventory/bulk-adjust` · `GET /v1/admin/inventory/movements` ·
`PATCH /v1/admin/inventory/:variantId/settings`
Permissions: `inventory:read`, `inventory:adjust`.
Adjust body: `{ "quantity_delta": -5, "reason": "WASTAGE", "note": "Bruised stock" }` —
`reason` is mandatory; an unexplained stock change is a governance failure, not a convenience.

### 11.7 Delivery configuration
`GET|POST /v1/admin/delivery-zones` · `GET|PATCH|DELETE /:id` ·
`POST /:id/pincodes` · `DELETE /:id/pincodes/:pincodeId`
`GET|POST /v1/admin/delivery-slots` · `GET|PATCH|DELETE /:id` ·
`POST /:id/activate` · `POST /:id/deactivate`
`GET /v1/admin/slot-capacity` · `PATCH /v1/admin/slot-capacity/:id` (override or block a date)
`GET|POST /v1/admin/holidays` · `DELETE /v1/admin/holidays/:id`
Permissions: `delivery:read`, `delivery:manage`.

**Deleting a slot** with future orders or active subscriptions returns
`409 SLOT_IN_USE` with counts and requires migration to another slot first (EC-D2).

### 11.7a Cities and pincodes **[PHASE 01 contract, PHASE 04 admin UI]**

| Method | Path | Permission |
|---|---|---|
| GET | `/v1/admin/cities` | `delivery:read` |
| POST | `/v1/admin/cities` | `delivery:manage` |
| GET | `/v1/admin/cities/:id` | `delivery:read` |
| PATCH | `/v1/admin/cities/:id` | `delivery:manage` |
| POST | `/v1/admin/cities/:id/activate` | `delivery:manage` |
| POST | `/v1/admin/cities/:id/deactivate` | `delivery:manage` |
| GET | `/v1/admin/pincodes` | `delivery:read` |
| POST | `/v1/admin/pincodes` | `delivery:manage` |
| PATCH | `/v1/admin/pincodes/:id` | `delivery:manage` |
| POST | `/v1/admin/pincodes/:id/activate` | `delivery:manage` |
| POST | `/v1/admin/pincodes/:id/deactivate` | `delivery:manage` |

**Status is never set through create or update.** `POST /cities` and `PATCH /cities/:id`
strip a `status` field if one is sent. Activation and deactivation are separate endpoints
because they are separate decisions with separate consequences: deactivating a city stops
revenue from an entire market, and that deserves its own audited action rather than being a
field buried in a form submission (BR-SV5).

Deactivation requires `{ "reason": "..." }` and writes an `audit_logs` row.
Activation is guarded: a city with no `ACTIVE` pincodes returns
`409 CITY_HAS_NO_ACTIVE_PINCODES`, and a pincode whose city is not `ACTIVE` returns
`409 CITY_INACTIVE` (BR-SV4).

**Deletion is not offered at any level.** Cities and pincodes are deactivated, never
removed, because historical addresses and orders must keep resolving to them forever
(BR-SV6).

### 11.8 Administration
`GET|POST /v1/admin/admin-users` · `GET|PATCH /:id` · `POST /:id/deactivate` ·
`POST /:id/roles` · `DELETE /:id/roles/:roleId` — `admin_users:*`
`GET|POST /v1/admin/roles` · `GET|PATCH|DELETE /:id` · `PUT /:id/permissions` — `roles:*`
`GET /v1/admin/permissions` — `roles:read`
`GET /v1/admin/audit-logs` (filter by actor, action, resource, date) — `audit:read`
`GET|PATCH /v1/admin/settings` — `settings:read`, `settings:update`

## 12. Internal API (worker only)

Not exposed through Cloudflare; bound to the Railway private network and authenticated with
a service token in `X-Internal-Token` compared in constant time.

| Method | Path | Description |
|---|---|---|
| POST | `/v1/internal/jobs/generate-deliveries` | Trigger the generator |
| POST | `/v1/internal/jobs/materialise-orders` | Trigger materialisation |
| POST | `/v1/internal/jobs/roll-slot-capacity` | Ensure capacity rows exist |
| POST | `/v1/internal/jobs/dispatch-outbox` | Drain the outbox |
| POST | `/v1/internal/jobs/send-reminders` | Delivery reminders |
| POST | `/v1/internal/cache/invalidate` | Bust the in-process cache |
| GET | `/v1/internal/jobs/status` | Last run, duration, outcome per job |

The worker normally calls `packages/core` directly in-process; these endpoints exist for
manual re-runs and for on-call recovery, and they are as idempotent as the jobs themselves.

## 13. Webhooks (inbound)

| Method | Path | Verification |
|---|---|---|
| POST | `/v1/webhooks/razorpay` | HMAC-SHA256 of the raw body against the webhook secret (P4) |
| POST | `/v1/webhooks/brevo` | Shared-secret header + source IP allow-list |
| POST | `/v1/webhooks/whatsapp` | Provider signature (P3) |

Rules for every inbound webhook: verify the signature against the **raw** body before
parsing; persist to `payment_webhook_events` (or its channel equivalent) **before**
processing; dedupe on provider `event_id`; always return `200` once stored, and process
asynchronously — retrying providers must never be able to cause duplicate business effects
(doc 19 §6).

## 14. Versioning and deprecation

- The URL carries the major version (`/v1`). It changes only for a breaking change.
- Additive changes (new optional field, new endpoint, new enum value) are **not** breaking;
  clients must ignore unknown fields. This is stated in the mobile SDK contract (doc 30).
- Deprecations emit `Deprecation` and `Sunset` response headers for at least 90 days.
- CI runs an OpenAPI diff against `main`; a breaking change without a version bump fails the
  build. This is the mechanism that protects shipped mobile apps from a backend deploy.
- `X-Client` enables a minimum-supported-version gate returning `426 CLIENT_UPGRADE_REQUIRED`
  when an old native build must be forced to update.

## 15. Complete error code catalogue

| Code | HTTP | Meaning |
|---|---|---|
| `VALIDATION_FAILED` | 422 | Zod validation failed; see `details[]` |
| `UNAUTHENTICATED` | 401 | Missing or invalid token |
| `TOKEN_EXPIRED` | 401 | Refresh and retry |
| `WRONG_AUDIENCE` | 401 | Customer token on an admin route or vice versa |
| `FORBIDDEN` | 403 | Authenticated, lacks permission |
| `ACCOUNT_SUSPENDED` | 403 | `users.status <> 'ACTIVE'` |
| `NOT_FOUND` | 404 | Missing, or not owned by the caller |
| `RATE_LIMITED` | 429 | Includes `Retry-After` |
| `CART_EMPTY` | 400 | |
| `ITEM_NOT_AVAILABLE` | 409 | Product or variant not purchasable |
| `INSUFFICIENT_STOCK` | 409 | Includes per-item available quantities |
| `MAX_QUANTITY_EXCEEDED` | 422 | Over `max_order_quantity` |
| `PRICE_CHANGED` | 409 | `expected_total_paise` mismatch |
| `MIN_ORDER_NOT_MET` | 422 | Below zone/slot minimum |
| `ADDRESS_NOT_SERVICEABLE` | 422 | Pincode outside every zone |
| `ADDRESS_IN_USE_BY_SUBSCRIPTION` | 409 | Cannot delete |
| `ADDRESS_LIMIT_REACHED` | 409 | Max 10 |
| `SLOT_CUTOFF_PASSED` | 409 | |
| `SLOT_CAPACITY_EXCEEDED` | 409 | |
| `SLOT_BLOCKED` | 409 | Blackout or holiday |
| `SLOT_NOT_AVAILABLE_ON_DAY` | 422 | Weekday not in `available_days` |
| `SLOT_IN_USE` | 409 | Admin cannot delete a slot in use |
| `ORDER_NOT_CANCELLABLE` | 409 | Past cutoff or wrong status |
| `INVALID_STATUS_TRANSITION` | 409 | Lists `allowed_transitions` |
| `SUBSCRIPTION_NOT_ACTIVE` | 409 | |
| `PAUSE_LIMIT_EXCEEDED` | 422 | |
| `PAUSE_NOTICE_TOO_SHORT` | 422 | |
| `INVALID_PAUSE_WINDOW` | 422 | |
| `SKIP_LIMIT_EXCEEDED` | 422 | |
| `SKIP_DEADLINE_PASSED` | 409 | |
| `DELIVERY_NOT_SKIPPABLE` | 409 | |
| `ALREADY_MATERIALISED` | 409 | Includes `order_id` |
| `MIN_DURATION_NOT_MET` | 409 | Cancellation before commitment ends |
| `PLAN_INACTIVE` | 409 | |
| `DUPLICATE_SUBSCRIPTION` | 409 | Same plan, slot, address, overlapping dates |
| `IDEMPOTENCY_KEY_REUSED` | 422 | Same key, different body |
| `IDEMPOTENT_REQUEST_IN_PROGRESS` | 409 | Concurrent retry; retry shortly |
| `COMBO_COMPONENT_UNAVAILABLE` | 409 | |
| `INVALID_SORT_FIELD` / `INVALID_PRICE_RANGE` / `SEARCH_QUERY_TOO_SHORT` | 422/400 | |
| `CLIENT_UPGRADE_REQUIRED` | 426 | Below minimum supported client version |
| `INTERNAL_ERROR` | 500 | Generic; `request_id` for support |
| `SERVICE_UNAVAILABLE` | 503 | Dependency down |
