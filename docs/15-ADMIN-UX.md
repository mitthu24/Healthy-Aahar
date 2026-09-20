# 15 — Admin Experience

`admin.maindomain.com` — a business operations console, not a CRUD form generator.

## 1. Principles

1. **The dashboard answers today's question**: what must be prepared, and where does it go.
2. **Density over decoration.** Tables, filters, keyboard shortcuts. Desktop-first
   (1440px), usable at 768px for a supervisor on a tablet in the kitchen.
3. **Destructive actions are deliberate.** Confirmation with typed consequences, never a
   bare "Are you sure?".
4. **Permission-aware UI.** Hide what the user cannot do, disable with an explanation what
   they could do but not right now.
5. **Every mutation is attributable.** The audit trail is a product feature, visible in the
   UI, not just a table.
6. **Operational speed.** Bulk actions, saved filters, exports. A 200-order morning must be
   processable in minutes.

## 2. Navigation

```
DASHBOARD
OPERATIONS     Orders · Subscriptions · Deliveries (prep & dispatch) · Exceptions
CATALOGUE      Products · Categories · Combos · Subscription plans · Inventory
CUSTOMERS      Customers · Reviews (P2)
DELIVERY       Zones · Slots · Capacity · Holidays
MARKETING      Coupons (P2) · Banners (P2) · Notifications
INSIGHTS       Reports · Analytics
SETTINGS       General · Admin users · Roles · Audit log
```
Menu items render only when the user holds the relevant permission (doc 08 §5.1).
A global command palette (`Cmd/Ctrl+K`) searches orders by number, customers by phone, and
products by name — the fastest path for a support call.

## 3. Dashboard

Three bands, in order of operational urgency.

### Band 1 — Today at a glance
| Widget | Value | Permission |
|---|---|---|
| Today's orders | Count + delta vs last week | `dashboard:read` |
| Today's revenue | ₹, COD collected vs due | `dashboard:read` |
| Pending confirmation | Count, links to filtered list | `orders:read` |
| Out for delivery | Count | `orders:read` |
| Active subscriptions | Count + net change this week | `subscriptions:read` |
| New customers today | Count | `customers:read` |

### Band 2 — Needs attention (the exception list)
The most important component in the panel. Empty is the goal.
- Orders stuck in a state past their slot window.
- `FAILED` subscription deliveries.
- `SUSPENDED` subscriptions.
- Out-of-stock variants with orders or subscriptions due tomorrow.
- Slots above 90% utilisation for tomorrow.
- COD marked `DUE` on delivered orders older than 24h.
- Combos whose components are unavailable.

Each row links straight to the action that resolves it.

### Band 3 — Operations
- **Slot utilisation** — horizontal bars per slot × next 3 days, with booked/capacity.
- **Order status distribution** — donut for today.
- **Tomorrow's prep forecast** — quantity per variant, combining one-time and subscription
  demand. This is the number the kitchen buys against.
- **Low stock** — table with inline adjust.
- **Top products (7 days)** — units and revenue.

Every widget links to its underlying filtered list. Nothing is a dead end.

## 4. Operations screens

### 4.1 Orders
Table columns: order number, customer, items count, total, slot, service date, status,
payment, placed at. Saved filter tabs: Today · Tomorrow · Pending · Preparing ·
Out for delivery · Issues.

Row actions respect the state machine: only legal next states appear (doc 09 §3).
**Bulk actions** (max 100): advance status, print, export.
Order detail shows items (combos nested), the full status timeline with actor and reason,
payment, address with a map link, customer summary with their other orders, internal notes,
and the audit trail.

### 4.2 Prep list — `/operations/deliveries/prep`
Grouped by slot, then by variant, showing total quantity required for a chosen date across
one-time **and** subscription orders. Combo components are counted through their exploded
component rows, so nothing is missed and nothing is double-counted (doc 12 §2).
Print-friendly. This screen is what the kitchen works from.

### 4.3 Dispatch manifest — `/operations/deliveries/dispatch`
Grouped by slot, then zone, then order: customer name, phone, address, items, COD amount.
Print-friendly. The delivery run works from this.

### 4.4 Subscriptions
Tabs: Active · Paused · Exceptions · Plans.
List with subscription number, customer, plan, schedule, slot, next delivery, status.
Detail shows items, the full delivery timeline with status per date, the lifecycle event log,
and admin actions (pause, resume, skip, change, cancel) — each recording
`actor_type='ADMIN'`.

**Exceptions tab** lists `FAILED` deliveries with their `failure_reason` and a one-click
"retry materialisation" once the blocker is cleared.

## 5. Catalogue screens

**Products** — table with image, name, category, variant count, price range, stock status,
status pill. Editor uses tabs: Basics · Variants · Images · Nutrition & info · SEO ·
Availability. Draft/publish workflow; publishing validates that at least one variant and one
image exist.

**Variants** — inline editable grid (SKU, name, unit, MRP, price, subscription price, tax,
availability, max quantity).

**Images** — drag-and-drop with presigned upload, reordering, mandatory alt text, `PENDING`
badge until the worker validates.

**Combos** — component picker with a live price calculator showing component sum, combo
price and customer saving, plus the warnings listed in doc 12 §7.

**Subscription plans** — contents, frequency, allowed days and slots, discount, and the rule
block (pause/skip limits, notice hours, min/max duration) that the customer app reads.

**Inventory** — see doc 13 §6. Bulk morning stock entry and one-tap out-of-stock are the two
interactions that must be fast.

## 6. Delivery configuration

**Zones** — name, code, city, fee, free-delivery threshold, minimum order, pincode manager
(bulk paste supported), active toggle.
**Slots** — name, window, cutoff (time + days before) with a live preview
("Orders for Tue 22 Sep close Mon 21 Sep, 10:00 PM"), available days, capacity, fee and
minimum overrides, zone assignment.
**Capacity** — calendar grid of slot × date showing `booked/capacity` with colour coding;
click a cell to override capacity or block the date. Reducing below `booked_count` is
rejected with an explanation (BR-D13).
**Holidays** — date, name, scope (all/zone/slot), with a warning showing how many existing
orders fall on that date. Declaring a holiday never auto-cancels orders.

## 7. Customers

List: name, phone (masked unless `customers:read_pii`), orders count, LTV, active
subscriptions, last order, status. Detail: profile, addresses, order history, subscriptions,
notification log, internal notes, suspend/reactivate.

Unmasking PII requires a reason and writes an audit entry (BR-SEC11). The UI states this
before the click, so it is a deterrent rather than a trap.

## 8. Settings and governance

**General** — business details, booking horizon, subscription horizons, default pause/skip
limits, support contacts. Each setting shows its key, current value and last editor.
**Admin users** — invite, assign roles, deactivate. The last Super Admin cannot be demoted
(BR-SEC6), and the UI explains why rather than silently disabling the control.
**Roles** — permission matrix editor with checkboxes grouped by resource; system roles are
read-only. Super Admin only.
**Audit log** — filterable by actor, action, resource and date, with a before/after diff
viewer. Exportable.

## 9. Reports

| Report | MVP | Contents |
|---|---|---|
| Sales | ✅ | Orders, revenue, AOV by day/week/month, by slot, by zone |
| Products | ✅ | Units and revenue by product/variant/category |
| Subscriptions | ✅ | Active, new, cancelled, churn %, revenue, deliveries fulfilled vs skipped |
| Customers | ✅ | New vs repeat, LTV distribution, cohort retention (simple) |
| Inventory | ✅ | Stock valuation, wastage by reason |
| Slot utilisation | ✅ | Booked vs capacity, rejection counts |
| Payments | ✅ | COD collected vs due, reconciliation |
| Marketing (P2) | | Coupon performance, campaign attribution |

All reports support a date range, comparison to the previous period, and CSV export
(`reports:export`). Exports are generated asynchronously and delivered as a signed download
link — a synchronous export of a year of orders would time out and is the classic cause of
admin-panel outages.

## 10. Analytics scope

**MVP** — the reports above, computed directly from Postgres with indexed queries and a
60-second cache.
**Phase 2** — nightly rollup tables (`daily_metrics`, `product_daily_metrics`) so dashboards
stop scanning `orders`; cohort retention; slot-demand forecasting.
**Phase 3** — a real warehouse or analytics service if query volume justifies it.

Deliberately not built now: custom report builders, funnel analysis, real-time streaming
dashboards. They are expensive, and with pre-launch order volumes they would visualise noise.

## 11. Admin performance and safety

- Tables are server-paginated with cursor pagination; no endpoint returns an unbounded list.
- Filters map to indexed columns only; a filter that cannot use an index is not offered.
- Bulk operations are capped (100 items) and run in one transaction with one audit entry.
- Every destructive confirmation states the consequence in words
  ("This cancels 14 scheduled deliveries. Orders already placed are not affected.").
- Session: 12h max, 30min idle timeout (doc 07 §5.2).
- The whole surface is `noindex` and, at launch, behind a Cloudflare Access policy or IP
  allow-list.
