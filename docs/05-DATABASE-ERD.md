# 05 — Database ERD

Diagrams are Mermaid and render in GitHub. They show relationships and cardinality;
[04-DATABASE-DESIGN.md](04-DATABASE-DESIGN.md) remains authoritative for columns and
constraints. Only key columns are shown, for legibility.

## 1. Context map

```mermaid
flowchart LR
  IDENTITY[Identity<br/>users, profiles, admins, roles]
  CATALOGUE[Catalogue<br/>categories, products, variants, combos]
  INVENTORY[Inventory<br/>stock, movements]
  FULFILMENT[Fulfilment<br/>zones, slots, capacity]
  ORDERING[Ordering<br/>carts, orders]
  SUBSCRIPTION[Subscription<br/>plans, subscriptions, deliveries]
  PAYMENT[Payment<br/>payments, refunds]
  ENGAGEMENT[Engagement<br/>outbox, notifications]
  GOVERNANCE[Governance<br/>audit, settings]

  IDENTITY --> ORDERING
  IDENTITY --> SUBSCRIPTION
  CATALOGUE --> ORDERING
  CATALOGUE --> SUBSCRIPTION
  CATALOGUE --> INVENTORY
  FULFILMENT --> ORDERING
  FULFILMENT --> SUBSCRIPTION
  SUBSCRIPTION --> ORDERING
  ORDERING --> INVENTORY
  ORDERING --> PAYMENT
  ORDERING --> ENGAGEMENT
  SUBSCRIPTION --> ENGAGEMENT
  IDENTITY --> GOVERNANCE
```

Read the arrows as "depends on / writes into". Note that **Subscription points at Ordering,
never the reverse**: a subscription creates orders, and an order merely remembers which
delivery produced it. That direction is what keeps the order state machine independent of
subscription concerns.

## 2. Identity and access

```mermaid
erDiagram
  businesses ||--o{ users : scopes
  users ||--o| customer_profiles : "1:0..1"
  users ||--o| admin_users : "1:0..1"
  customer_profiles ||--o{ addresses : owns
  admin_users }o--o{ roles : "via admin_user_roles"
  roles }o--o{ permissions : "via role_permissions"

  users {
    uuid id PK
    text firebase_uid
    enum user_type "CUSTOMER|ADMIN"
    text email
    text phone
    enum status
  }
  customer_profiles {
    uuid id PK
    uuid user_id FK "UNIQUE"
    text first_name
    uuid default_address_id FK
    bigint lifetime_value_paise
  }
  admin_users {
    uuid id PK
    uuid user_id FK "UNIQUE"
    text full_name
    bool is_super_admin
    timestamptz deleted_at
  }
  addresses {
    uuid id PK
    uuid customer_profile_id FK
    text pincode
    uuid delivery_zone_id FK
    bool is_default
  }
  roles {
    uuid id PK
    citext key "UNIQUE"
    bool is_system
  }
  permissions {
    uuid id PK
    citext key "resource:action"
  }
```

**Key point:** `users` is the single identity table for both audiences, discriminated by
`user_type` and uniquely keyed by `(firebase_uid, user_type)`. Profile data is split into
`customer_profiles` and `admin_users` so the two never share columns and an accidental
`SELECT *` on a customer cannot leak staff fields.

## 3. Catalogue

```mermaid
erDiagram
  categories ||--o{ categories : "parent_id (2 levels)"
  categories ||--o{ products : contains
  products ||--|{ product_variants : "1..N (purchasable unit)"
  products ||--o{ product_images : has
  product_variants ||--o{ product_images : "variant-specific"
  products }o--o{ tags : "via product_tags"
  combos ||--|{ combo_items : contains
  combo_items }o--|| product_variants : references
  product_variants ||--o| inventory : "1:0..1 per location"

  categories {
    uuid id PK
    uuid parent_id FK
    citext slug
    int display_order
    bool is_active
  }
  products {
    uuid id PK
    uuid category_id FK
    citext slug
    enum status
    bool is_subscribable
    jsonb nutrition
    text[] dietary_tags
    tsvector search_vector
  }
  product_variants {
    uuid id PK
    uuid product_id FK
    citext sku
    bigint price_paise
    bigint subscription_price_paise
    enum availability
    bool is_default
  }
  combos {
    uuid id PK
    citext slug
    text pricing_mode "FIXED|DISCOUNT"
    bigint price_paise
    bool is_subscribable
  }
  combo_items {
    uuid combo_id FK
    uuid variant_id FK
    int quantity
  }
```

**Key point:** the purchasable unit is always `product_variants`. `products` carries
marketing and nutrition information; it has no price. Combos reference variants, never
products, so every purchase path resolves to the same leaf entity.

## 4. Fulfilment — zones, slots, capacity

```mermaid
erDiagram
  delivery_zones ||--|{ zone_pincodes : covers
  delivery_zones ||--o{ addresses : "resolved by pincode"
  delivery_slots }o--o{ delivery_zones : "via slot_zone_assignments"
  delivery_slots ||--o{ slot_capacity : "one row per date x zone"
  delivery_zones ||--o{ slot_capacity : scopes
  delivery_zones ||--o{ business_holidays : "may scope"
  delivery_slots ||--o{ business_holidays : "may scope"
  slot_capacity ||--o{ orders : "booked_count tracks"

  delivery_zones {
    uuid id PK
    citext code
    bigint delivery_fee_paise
    bigint min_order_value_paise
    bool is_active
  }
  zone_pincodes {
    uuid delivery_zone_id FK
    text pincode "UNIQUE per business"
  }
  delivery_slots {
    uuid id PK
    citext code
    time start_time
    time end_time
    time cutoff_time
    int cutoff_days_before
    smallint[] available_days
    int default_capacity
  }
  slot_capacity {
    uuid id PK
    uuid delivery_slot_id FK
    uuid delivery_zone_id FK
    date service_date
    int capacity
    int booked_count
    bool is_blocked
  }
```

**Key point:** `slot_capacity` is the only table that is locked during checkout. Its unique
key `(delivery_slot_id, delivery_zone_id, service_date)` plus
`CHECK (booked_count <= capacity)` make over-booking a database error rather than an
operational disaster.

## 5. Ordering

```mermaid
erDiagram
  customer_profiles ||--o| carts : "1 active"
  carts ||--o{ cart_items : contains
  customer_profiles ||--o{ orders : places
  orders ||--|{ order_items : contains
  orders ||--|{ order_status_history : logs
  orders ||--o| payments : "1:1"
  payments ||--o{ payment_attempts : has
  payments ||--o{ refunds : has
  orders }o--|| delivery_slots : "snapshot + FK"
  orders }o--|| delivery_zones : "FK"
  orders }o--o| addresses : "FK + JSON snapshot"
  order_items }o--o| product_variants : references
  order_items }o--o| combos : references
  order_items ||--o{ order_items : "parent_item_id (combo explosion)"

  orders {
    uuid id PK
    text order_number "UNIQUE"
    enum status
    enum source "ONE_TIME|SUBSCRIPTION"
    uuid subscription_delivery_id FK "UNIQUE when set"
    date service_date
    jsonb address_snapshot
    bigint subtotal_paise
    bigint total_paise
    enum payment_status
  }
  order_items {
    uuid id PK
    uuid order_id FK
    uuid variant_id FK "XOR combo_id"
    uuid combo_id FK
    uuid parent_item_id FK
    bool is_component
    int quantity
    bigint unit_price_paise
    bigint line_total_paise
  }
  payments {
    uuid id PK
    uuid order_id FK "UNIQUE"
    enum method "COD at MVP"
    enum status
    bigint amount_paise
  }
```

### 5.1 How a combo is stored in an order

```
orders
└── order_items
    ├── [parent]    combo_id = Morning Wellness Combo
    │                is_component = false
    │                quantity = 1
    │                unit_price_paise = 24900     ← the money lives here
    │                line_total_paise = 24900
    ├── [component] variant_id = Mixed Fruit Bowl 250g
    │                is_component = true, parent_item_id = parent
    │                quantity = 1, unit_price_paise = 0   ← logistics only
    ├── [component] variant_id = Moong Sprouts 150g
    │                is_component = true, parent_item_id = parent
    └── [component] variant_id = Orange Juice 200ml
                     is_component = true, parent_item_id = parent
```
`subtotal_paise` sums only rows where `is_component = false`.
Inventory reservation and the kitchen prep list read only rows where `is_component = true`
(plus non-combo lines). Neither view double-counts.

## 6. Subscription

```mermaid
erDiagram
  subscription_plans ||--o{ subscription_plan_items : defines
  subscription_plans ||--o{ subscriptions : "instantiated as"
  customer_profiles ||--o{ subscriptions : owns
  subscriptions ||--|{ subscription_items : contains
  subscriptions ||--o{ subscription_deliveries : schedules
  subscriptions ||--o{ subscription_events : logs
  subscription_deliveries ||--o| orders : "materialises into (0..1)"
  subscriptions }o--|| delivery_slots : uses
  subscriptions }o--|| addresses : "delivers to"

  subscription_plans {
    uuid id PK
    citext slug
    enum frequency_type
    smallint[] allowed_days
    int max_pause_days_per_month
    int max_skips_per_month
    enum status
  }
  subscriptions {
    uuid id PK
    text subscription_number "UNIQUE"
    uuid customer_profile_id FK
    uuid subscription_plan_id FK
    enum status "ACTIVE|PAUSED|CANCELLED|EXPIRED|SUSPENDED"
    smallint[] delivery_days
    date start_date
    date end_date
    date next_delivery_date
    date generated_until_date "scheduler watermark"
    bigint price_per_delivery_paise "locked"
  }
  subscription_items {
    uuid id PK
    uuid subscription_id FK
    uuid variant_id FK "XOR combo_id"
    int quantity
    bigint unit_price_paise "locked"
  }
  subscription_deliveries {
    uuid id PK
    uuid subscription_id FK
    date delivery_date "UNIQUE with subscription_id"
    enum status "SCHEDULED|SKIPPED|ORDER_CREATED|FULFILLED|FAILED|CANCELLED"
    uuid order_id FK "UNIQUE when set"
    bigint expected_total_paise
  }
```

### 6.1 The two constraints that prevent duplicate deliveries

```
UNIQUE (subscription_id, delivery_date)         on subscription_deliveries
UNIQUE (subscription_delivery_id) WHERE NOT NULL on orders
```

The first stops the **generator** from scheduling a date twice. The second stops the
**materialiser** from turning one delivery into two orders. Together they make the guarantee
structural rather than procedural — it holds under concurrent workers, retries, replays and
redeploys, without any distributed lock. This is the single most important pair of
constraints in the schema (BR-S9).

### 6.2 Subscription to order flow

```mermaid
sequenceDiagram
  autonumber
  participant Cron as worker (01:00 IST)
  participant Gen as generateDeliveries
  participant DB as PostgreSQL
  participant Mat as materialiseOrders (hourly)
  participant Out as outbox

  Cron->>Gen: for each ACTIVE subscription
  Gen->>DB: read generated_until_date
  Gen->>Gen: expand recurrence to horizon<br/>minus holidays, pause window, end_date
  Gen->>DB: INSERT subscription_deliveries<br/>ON CONFLICT (subscription_id, delivery_date) DO NOTHING
  Gen->>DB: UPDATE generated_until_date, next_delivery_date

  Note over Mat: separately, hourly
  Mat->>DB: SELECT deliveries WHERE status='SCHEDULED'<br/>AND delivery_date <= today + materialise_horizon
  Mat->>DB: BEGIN; lock delivery row FOR UPDATE
  Mat->>DB: lock slot_capacity FOR UPDATE, check + increment
  Mat->>DB: reserve inventory
  Mat->>DB: INSERT order (subscription_delivery_id = delivery.id)
  Mat->>DB: UPDATE delivery SET status='ORDER_CREATED', order_id
  Mat->>Out: INSERT outbox SUBSCRIPTION_ORDER_CREATED
  Mat->>DB: COMMIT
```

If any step fails, the whole transaction rolls back, the delivery stays `SCHEDULED`, and the
next hourly run retries it. If it keeps failing past the cutoff, it is marked `FAILED` with a
`failure_reason`, the customer is notified, and it appears on the ops exception list
(EC-S2, EC-S3).

## 7. Inventory

```mermaid
erDiagram
  product_variants ||--o| inventory : "per location"
  inventory ||--|{ inventory_movements : "append-only ledger"
  orders ||--o{ inventory_movements : "via reference_id"

  inventory {
    uuid id PK
    uuid variant_id FK
    text location_code "default MAIN"
    int quantity_on_hand
    int quantity_reserved
    int low_stock_threshold
    bool track_inventory
  }
  inventory_movements {
    uuid id PK
    uuid inventory_id FK
    enum reason
    int quantity_delta "signed"
    int quantity_after
    int reserved_delta
    text reference_type
    uuid reference_id
  }
```

`quantity_available = quantity_on_hand - quantity_reserved` is always computed, never
stored. Every mutation of `inventory` writes a matching `inventory_movements` row in the
same transaction, so the ledger can always be replayed to verify the balance.

## 8. Engagement and governance

```mermaid
erDiagram
  notification_outbox ||--o{ notification_logs : "fan out per channel"
  users ||--o{ notifications : receives
  users ||--o{ notification_logs : "addressed to"
  users ||--o{ notification_preferences : configures
  users ||--o{ audit_logs : "actor (SET NULL)"
  customer_profiles ||--o{ favorites : saves

  notification_outbox {
    uuid id PK
    text event_type
    text aggregate_type
    uuid aggregate_id
    jsonb payload
    text dedupe_key "UNIQUE when set"
    enum status
    int attempts
    timestamptz available_at
  }
  notification_logs {
    uuid id PK
    uuid outbox_id FK
    enum channel
    text template_key
    text provider_message_id
    text status
  }
  audit_logs {
    uuid id PK
    uuid actor_user_id FK
    text action
    text resource_type
    uuid resource_id
    jsonb before
    jsonb after
  }
```

## 9. Full relationship reference

| Parent | Child | Card. | On delete | Note |
|---|---|---|---|---|
| businesses | everything operational | 1:N | RESTRICT | Multi-business seam |
| users | customer_profiles | 1:0..1 | RESTRICT | |
| users | admin_users | 1:0..1 | RESTRICT | |
| customer_profiles | addresses | 1:N | RESTRICT | Soft delete instead |
| customer_profiles | carts | 1:0..1 | CASCADE | |
| customer_profiles | orders | 1:N | RESTRICT | |
| customer_profiles | subscriptions | 1:N | RESTRICT | |
| customer_profiles | favorites | 1:N | CASCADE | |
| categories | categories | 1:N | RESTRICT | Max depth 2 |
| categories | products | 1:N | RESTRICT | |
| products | product_variants | 1:N (≥1) | RESTRICT | |
| products | product_images | 1:N | CASCADE | |
| product_variants | inventory | 1:0..1 per location | CASCADE | |
| product_variants | cart_items | 1:N | CASCADE | |
| product_variants | order_items | 1:N | RESTRICT | History |
| product_variants | combo_items | 1:N | RESTRICT | |
| combos | combo_items | 1:N (≥1) | CASCADE | |
| delivery_zones | zone_pincodes | 1:N | CASCADE | |
| delivery_zones | slot_capacity | 1:N | CASCADE | |
| delivery_slots | slot_capacity | 1:N | CASCADE | |
| delivery_slots | orders | 1:N | RESTRICT | Snapshot also stored |
| carts | cart_items | 1:N | CASCADE | |
| orders | order_items | 1:N | CASCADE | |
| orders | order_status_history | 1:N | CASCADE | |
| orders | payments | 1:0..1 | RESTRICT | |
| payments | payment_attempts | 1:N | CASCADE | |
| payments | refunds | 1:N | RESTRICT | |
| subscription_plans | subscriptions | 1:N | RESTRICT | |
| subscriptions | subscription_items | 1:N | CASCADE | |
| subscriptions | subscription_deliveries | 1:N | RESTRICT | |
| subscriptions | subscription_events | 1:N | CASCADE | |
| subscription_deliveries | orders | 1:0..1 | SET NULL | Partial unique |
| inventory | inventory_movements | 1:N | RESTRICT | |
| notification_outbox | notification_logs | 1:N | CASCADE | |
| roles | role_permissions | 1:N | CASCADE | |
| admin_users | admin_user_roles | 1:N | CASCADE | |

## 10. Entities that are easy to confuse

| These are different | Because |
|---|---|
| **User** vs **Customer** | `users` is an identity (a Firebase login). `customer_profiles` is a commercial relationship. An admin has a user but no customer profile. |
| **Product** vs **Variant** | A product is what you read about. A variant is what you buy. Prices, SKUs, stock and orders attach to the variant only. |
| **Combo** vs **Product** | A combo is a sellable bundle of variants with its own price. It is never a category of product and never has its own inventory row. |
| **Order** vs **Subscription** | An order is one delivery's commercial transaction. A subscription is a standing instruction that produces many orders over time. |
| **Subscription** vs **Subscription Delivery** | The subscription is the contract. A delivery is one dated occurrence of it, which may be skipped and may never become an order. |
| **Subscription Delivery** vs **Order** | A delivery is the *plan*; the order is the *execution*. `SKIPPED` deliveries never produce an order — which is exactly why the two are separate tables. |
| **Slot** vs **Slot Capacity** | A slot is a recurring rule ("Morning 06:00–08:00, Mon–Fri"). Capacity is the bookable inventory of that rule on one concrete date in one zone. |
| **Availability** vs **Stock** | Availability is editorial ("we are not selling this today"). Stock is quantitative. Both must pass for a line to be purchasable. |
| **Audit log** vs **application log** | Audit logs are durable business facts in Postgres. Application logs are ephemeral technical telemetry. |
