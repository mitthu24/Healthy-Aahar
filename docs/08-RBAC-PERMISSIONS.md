# 08 — RBAC & Permissions

## 1. Model

```
admin_user ──< admin_user_roles >── role ──< role_permissions >── permission
```

- An admin may hold **multiple roles**; effective permissions are the **union**.
- There are **no deny rules**. Deny-overrides makes effective permissions hard to reason
  about and harder to audit; additive-only means "what can this person do?" is a single
  query with an obvious answer.
- `admin_users.is_super_admin = true` bypasses all checks. It is granted to as few people as
  possible, and it is itself audited.
- Permission keys are `resource:action` and are seeded by migration, not editable at runtime.
  A new permission arrives with the feature that needs it.

### Why roles and permissions rather than a single `role` column

A `role` enum forces a code deploy every time the business wants a slightly different
combination of duties — and real operations teams always want that. With roles as data, the
owner can create "Weekend Supervisor" from the admin panel. Permissions stay as code because
they are a contract with the routes: inventing a permission key that no route checks would
create a false sense of control.

## 2. Permission catalogue

Every key below maps to at least one API route in
[06-API-SPECIFICATION.md](06-API-SPECIFICATION.md). The route declaration is the enforcement
point; this table is the human-readable index.

### Dashboard & reporting
| Key | Grants |
|---|---|
| `dashboard:read` | View the operations dashboard |
| `reports:read` | View sales, product, subscription and customer reports |
| `reports:export` | Download CSV/XLSX exports (separate because exports remove data from the system) |

### Orders
| Key | Grants |
|---|---|
| `orders:read` | List and view orders, prep lists, dispatch manifests |
| `orders:update_status` | Move an order through the lifecycle |
| `orders:update` | Edit internal notes, reassign slot |
| `orders:cancel` | Cancel an order |
| `orders:refund` | Initiate a refund (P2) |

### Subscriptions
| Key | Grants |
|---|---|
| `subscriptions:read` | List and view subscriptions and deliveries |
| `subscriptions:update` | Pause, resume, change quantity/slot/address on a customer's behalf |
| `subscriptions:cancel` | Cancel a subscription |
| `subscriptions:manage_plans` | Create and edit subscription plans |

### Catalogue
| Key | Grants |
|---|---|
| `catalog:read` | View categories, products, variants, combos |
| `catalog:create` | Create catalogue entities |
| `catalog:update` | Edit catalogue entities, including price |
| `catalog:delete` | Soft-delete catalogue entities |
| `catalog:publish` | Move a product between `DRAFT` and `ACTIVE` |

> `catalog:update` includes price editing at MVP. If price changes need separate control
> later, `catalog:update_price` is added and the check in the variant route is narrowed —
> a one-line change because the permission is declared at the route.

### Inventory
| Key | Grants |
|---|---|
| `inventory:read` | View stock levels and movement history |
| `inventory:adjust` | Adjust stock, record wastage |
| `inventory:settings` | Change thresholds and tracking flags |

### Customers
| Key | Grants |
|---|---|
| `customers:read` | List and view customers (contact details **masked**) |
| `customers:read_pii` | Unmask phone and email — audited on every unmask |
| `customers:update` | Edit internal notes |
| `customers:suspend` | Suspend or reactivate an account |

### Delivery configuration
| Key | Grants |
|---|---|
| `delivery:read` | View zones, slots, capacity, holidays |
| `delivery:manage` | Create and edit zones, slots, capacity overrides, holidays |

### Payments
| Key | Grants |
|---|---|
| `payments:read` | View payment records |
| `payments:collect` | Mark COD as collected |
| `payments:refund` | Issue refunds (P2/P4) |

### Promotions (P2)
| Key | Grants |
|---|---|
| `promotions:read` / `promotions:manage` | Coupons and campaigns |

### Content (P2)
| Key | Grants |
|---|---|
| `content:read` / `content:manage` | Banners, FAQ, blog, policy pages |
| `reviews:moderate` | Approve or reject reviews |

### Administration
| Key | Grants |
|---|---|
| `admin_users:read` | View staff accounts |
| `admin_users:create` | Invite staff |
| `admin_users:update` | Edit staff, assign roles |
| `admin_users:deactivate` | Deactivate staff |
| `roles:read` | View roles and permissions |
| `roles:manage` | Create roles and change their permissions — **Super Admin only** |
| `settings:read` / `settings:update` | Runtime configuration |
| `audit:read` | View audit logs |
| `notifications:send` | Send a manual notification to a customer |

## 3. Initial roles

Seven roles at MVP. The brief suggested nine; `ANALYST` and `DELIVERY_MANAGER` are deferred
because at launch there is no separate analytics function and no rider fleet to manage —
inventing roles nobody holds produces an access model nobody maintains. Both are trivial to
add later, which is the point of storing roles as data.

### `SUPER_ADMIN`
Owner/founder. `is_super_admin = true`, bypasses all checks. **Target: 1–2 people.**
Exclusively able to manage roles, and the only role that can create another Super Admin.

### `ADMIN`
General manager. Everything operational, **except** role management and Super Admin
creation. This separation means a compromised general-admin account cannot grant itself more
power.

| Permissions |
|---|
| `dashboard:read`, `reports:read`, `reports:export` |
| `orders:*` |
| `subscriptions:*` |
| `catalog:*` |
| `inventory:read`, `inventory:adjust`, `inventory:settings` |
| `customers:read`, `customers:read_pii`, `customers:update`, `customers:suspend` |
| `delivery:read`, `delivery:manage` |
| `payments:read`, `payments:collect` |
| `admin_users:read`, `admin_users:create`, `admin_users:update`, `admin_users:deactivate` |
| `settings:read`, `settings:update`, `audit:read`, `notifications:send` |

### `OPERATIONS_MANAGER`
Runs the daily fulfilment cycle. The most-used role.

| Permissions |
|---|
| `dashboard:read`, `reports:read` |
| `orders:read`, `orders:update_status`, `orders:update`, `orders:cancel` |
| `subscriptions:read`, `subscriptions:update` |
| `catalog:read` |
| `inventory:read`, `inventory:adjust` |
| `customers:read`, `customers:read_pii` |
| `delivery:read`, `delivery:manage` |
| `payments:read`, `payments:collect` |
| `notifications:send` |

Has `customers:read_pii` because calling a customer about a delivery is core to the job.
Cannot cancel subscriptions or touch the catalogue — those are commercial decisions.

### `INVENTORY_MANAGER`
Kitchen and stock.

| Permissions |
|---|
| `dashboard:read`, `catalog:read`, `catalog:update` |
| `inventory:read`, `inventory:adjust`, `inventory:settings` |
| `orders:read` (to see demand) |

`catalog:update` is included so this role can mark a variant `OUT_OF_STOCK` — the single
most time-critical action in the business, and it should not require finding a manager.

### `ORDER_MANAGER`
Order desk only. Narrower than Operations Manager, for a larger team.

| Permissions |
|---|
| `dashboard:read`, `orders:read`, `orders:update_status`, `orders:update` |
| `catalog:read`, `customers:read` |
| `delivery:read`, `payments:read` |

Note: no `orders:cancel` and no `customers:read_pii`.

### `CUSTOMER_SUPPORT`
Handles customer contact. Can see and explain, can act on the customer's behalf within
limits, cannot change the business.

| Permissions |
|---|
| `orders:read`, `orders:cancel` |
| `subscriptions:read`, `subscriptions:update`, `subscriptions:cancel` |
| `customers:read`, `customers:read_pii`, `customers:update` |
| `catalog:read`, `delivery:read`, `payments:read`, `notifications:send` |

Deliberately **has** `subscriptions:cancel` (a customer asking to cancel must not be
escalated) and deliberately **lacks** `orders:update_status` (support must not be able to
mark an order delivered).

### `CONTENT_MANAGER`
Catalogue content and merchandising.

| Permissions |
|---|
| `catalog:read`, `catalog:create`, `catalog:update`, `catalog:publish` |
| `content:read`, `content:manage` (P2), `reviews:moderate` (P2) |
| `promotions:read` (P2) |

No `catalog:delete`, no inventory, no orders, no customer data.

### Deferred roles
- **`ANALYST`** (P2): `dashboard:read`, `reports:read`, `reports:export`, `catalog:read`,
  read-only everywhere else. Add when there is a dedicated analytics function.
- **`DELIVERY_MANAGER`** (P3): `orders:read`, `orders:update_status` limited to dispatch
  states, `delivery:*`, `payments:collect`. Add with the delivery-partner module.

## 4. Role × permission matrix

`●` granted · `○` not granted

| Permission | SUPER | ADMIN | OPS | INV | ORD | SUPPORT | CONTENT |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| `dashboard:read` | ● | ● | ● | ● | ● | ○ | ○ |
| `reports:read` | ● | ● | ● | ○ | ○ | ○ | ○ |
| `reports:export` | ● | ● | ○ | ○ | ○ | ○ | ○ |
| `orders:read` | ● | ● | ● | ● | ● | ● | ○ |
| `orders:update_status` | ● | ● | ● | ○ | ● | ○ | ○ |
| `orders:update` | ● | ● | ● | ○ | ● | ○ | ○ |
| `orders:cancel` | ● | ● | ● | ○ | ○ | ● | ○ |
| `orders:refund` | ● | ● | ○ | ○ | ○ | ○ | ○ |
| `subscriptions:read` | ● | ● | ● | ○ | ○ | ● | ○ |
| `subscriptions:update` | ● | ● | ● | ○ | ○ | ● | ○ |
| `subscriptions:cancel` | ● | ● | ○ | ○ | ○ | ● | ○ |
| `subscriptions:manage_plans` | ● | ● | ○ | ○ | ○ | ○ | ○ |
| `catalog:read` | ● | ● | ● | ● | ● | ● | ● |
| `catalog:create` | ● | ● | ○ | ○ | ○ | ○ | ● |
| `catalog:update` | ● | ● | ○ | ● | ○ | ○ | ● |
| `catalog:delete` | ● | ● | ○ | ○ | ○ | ○ | ○ |
| `catalog:publish` | ● | ● | ○ | ○ | ○ | ○ | ● |
| `inventory:read` | ● | ● | ● | ● | ○ | ○ | ○ |
| `inventory:adjust` | ● | ● | ● | ● | ○ | ○ | ○ |
| `inventory:settings` | ● | ● | ○ | ● | ○ | ○ | ○ |
| `customers:read` | ● | ● | ● | ○ | ● | ● | ○ |
| `customers:read_pii` | ● | ● | ● | ○ | ○ | ● | ○ |
| `customers:update` | ● | ● | ○ | ○ | ○ | ● | ○ |
| `customers:suspend` | ● | ● | ○ | ○ | ○ | ○ | ○ |
| `delivery:read` | ● | ● | ● | ○ | ● | ● | ○ |
| `delivery:manage` | ● | ● | ● | ○ | ○ | ○ | ○ |
| `payments:read` | ● | ● | ● | ○ | ● | ● | ○ |
| `payments:collect` | ● | ● | ● | ○ | ○ | ○ | ○ |
| `payments:refund` | ● | ○ | ○ | ○ | ○ | ○ | ○ |
| `admin_users:read` | ● | ● | ○ | ○ | ○ | ○ | ○ |
| `admin_users:create` | ● | ● | ○ | ○ | ○ | ○ | ○ |
| `admin_users:update` | ● | ● | ○ | ○ | ○ | ○ | ○ |
| `admin_users:deactivate` | ● | ● | ○ | ○ | ○ | ○ | ○ |
| `roles:read` | ● | ● | ○ | ○ | ○ | ○ | ○ |
| `roles:manage` | ● | ○ | ○ | ○ | ○ | ○ | ○ |
| `settings:read` | ● | ● | ○ | ○ | ○ | ○ | ○ |
| `settings:update` | ● | ● | ○ | ○ | ○ | ○ | ○ |
| `audit:read` | ● | ● | ○ | ○ | ○ | ○ | ○ |
| `notifications:send` | ● | ● | ● | ○ | ○ | ● | ○ |
| `content:manage` (P2) | ● | ● | ○ | ○ | ○ | ○ | ● |
| `promotions:manage` (P2) | ● | ● | ○ | ○ | ○ | ○ | ○ |

## 5. Enforcement

### 5.1 Three layers, one source of truth

```
1. API route declaration   ← the only layer that is security
   route({ method:'POST', path:'/v1/admin/orders/:id/status',
           audience:'ADMIN', permission:'orders:update_status' }, handler)

2. Admin UI navigation     ← UX: hide what the user cannot do
   <RequirePermission need="orders:update_status"> … </RequirePermission>

3. Admin middleware        ← UX: redirect to sign-in before rendering a doomed page
```

Layers 2 and 3 read the permission list returned by `/v1/auth/me`. They reduce confusion;
they do not protect anything. An engineer who adds an admin route without a `permission`
field gets a **boot-time failure** — the route registry asserts that every `ADMIN`-audience
route declares one. Forgetting is therefore impossible, not merely discouraged.

### 5.2 Resolution and caching
Effective permissions are resolved with one query joining
`admin_user_roles → role_permissions → permissions`, cached in-process for 60 seconds keyed
by `admin_user_id`. Any write to `admin_user_roles` or `role_permissions` bumps a version
counter that invalidates the cache immediately, so a revoked permission does not linger.

### 5.3 Audit
Every permission-relevant event is written to `audit_logs`:
`admin_user.invited`, `admin_user.role_granted`, `admin_user.role_revoked`,
`admin_user.deactivated`, `role.created`, `role.permissions_changed`,
`customer.pii_unmasked`, `settings.updated`, and every denied request with a
`FORBIDDEN` outcome (denials are the interesting security signal).

## 6. Invariants

| ID | Invariant | Enforced |
|---|---|---|
| BR-SEC6 | At least one active Super Admin must always exist | Service layer blocks demoting or deactivating the last one |
| BR-SEC7 | Only a Super Admin may grant `roles:manage` or create a Super Admin | Explicit check, not permission-based |
| BR-SEC8 | An admin cannot modify their own roles | Service layer compares actor to target |
| BR-SEC9 | System roles (`is_system=true`) cannot be deleted or have their key renamed | DB flag + service check |
| BR-SEC10 | Deactivating an admin revokes their Firebase refresh tokens within the same operation | Transaction + Firebase Admin SDK call with retry |
| BR-SEC11 | Unmasking customer PII is always audited with a reason | Route requires `reason` in the body |

## 7. Extending the model later

| Need | Approach | Phase |
|---|---|---|
| New role | Create it in the admin panel; no deploy | Now |
| New permission | Migration adds the row; feature route declares it | With the feature |
| Per-zone scoping ("this manager only sees Zone 2") | Add `admin_user_scopes (admin_user_id, delivery_zone_id)`; repositories apply the scope filter | P3, when there are ≥ 2 zones |
| Field-level permissions | Not planned; masking (as with PII) handles the real cases | — |
| Temporary elevation | `admin_user_roles.expires_at` + a nightly expiry job | P3 |
| Approval workflows (two-person refunds) | A separate `approvals` table; not RBAC | FUT |
