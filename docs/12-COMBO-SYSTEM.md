# 12 — Combo System

## 1. What a combo is

A **combo** is a bundle of product variants sold as a single purchasable line at a bundle
price. `Morning Wellness Combo` = Mixed Fruit Bowl 250g + Moong Sprouts 150g + Orange Juice
200ml, for ₹249 instead of ₹297.

A combo is **not**:
- a category (a category groups products for browsing),
- a product with child products (that would need a second pricing model),
- a discount rule (coupons handle those),
- an inventory item (it has no stock of its own).

## 2. The core design decision: parent plus components

A combo faces two incompatible demands:

- **Money** wants one line: the customer pays ₹249 for "Morning Wellness Combo", and the
  invoice must say exactly that.
- **Logistics** wants three lines: the kitchen prepares three items, and inventory must
  decrement three variants.

Neither can be discarded, and satisfying only one creates a familiar class of bugs — either
inventory silently drifts because combos never decrement stock, or the invoice lists three
items whose prices do not add up to what was charged.

**Solution:** an order stores both, in one table, distinguished by a flag.

```
order_items
├── parent      combo_id=MWC, is_component=false, quantity=1
│                unit_price_paise=24900, line_total_paise=24900   ← money
├── component   variant_id=FRUIT-250, is_component=true, parent_item_id=parent
│                quantity=1, unit_price_paise=0                   ← logistics
├── component   variant_id=SPRT-150, is_component=true, parent_item_id=parent
└── component   variant_id=JUICE-200, is_component=true, parent_item_id=parent
```

**Reading rules — memorise these three:**

| Consumer | Reads |
|---|---|
| Money: subtotal, invoice, revenue reports | rows where `is_component = false` |
| Logistics: inventory, prep list, packing | rows where `is_component = true`, plus non-combo rows |
| Customer UI | parents, with components nested for display |

Because the two views filter on disjoint sets, nothing is ever double-counted. `subtotal_paise`
sums parents; inventory reservation sums components. The alternative — a separate
`order_combo_items` table — would require every query touching order contents to union two
tables forever.

## 3. Pricing

| Mode | Configuration | Price |
|---|---|---|
| `FIXED` | `price_paise = 24900` | Exactly ₹249.00 |
| `DISCOUNT` | `discount_type='PERCENTAGE'`, `discount_value=1500` (bps) | 15% off the live component sum |

`FIXED` is the default and the recommended mode: the customer sees a stable, marketable
price, and a component price change does not silently move the combo price. `DISCOUNT` is
useful for "10% off any bundle" merchandising where the saving is the message.

**Savings display** is always computed against the live component sum:
```
component_sum = Σ (variant.price_paise × combo_item.quantity)
savings       = component_sum − combo_price
```
If `component_sum ≤ combo_price` the savings badge is hidden rather than showing a negative
saving — a combo that has become more expensive than its parts is a merchandising bug, and
it is surfaced on the admin combo list as a warning (BR-B6).

**Subscription pricing:** `combos.subscription_price_paise`, when set, replaces the combo
price for subscription lines, exactly mirroring `product_variants.subscription_price_paise`.

**Tax:** computed on the parent line using a weighted average of component `tax_rate_bps`,
proportional to component value, so a mixed-rate combo apportions GST correctly.

## 4. Availability

A combo is purchasable only when **all** of the following hold:

```
combo.status = 'ACTIVE' AND combo.deleted_at IS NULL
AND (available_from IS NULL OR today >= available_from)
AND (available_until IS NULL OR today <= available_until)
AND for every component:
      product.status = 'ACTIVE'
      variant.availability = 'AVAILABLE'
      variant.deleted_at IS NULL
      (NOT track_inventory OR quantity_available >= combo_item.quantity × requested_qty)
```

Availability is **derived, never stored**. A cached `is_available` column would go stale the
moment a component sold out, and the failure mode — selling a combo that cannot be made — is
exactly the one that damages a fresh-food brand.

Computation cost is one indexed join, cached in-process for 60 seconds on list endpoints and
computed live at checkout, where correctness matters more than a few milliseconds.

**Partial availability** is surfaced honestly: the combo card shows
"Temporarily unavailable — Orange Juice is out of stock" rather than a blank disabled button.
Customers forgive a stockout; they do not forgive a mystery.

## 5. Inventory

```
Add combo ×2 to cart     → no reservation (carts reserve nothing)
Place order              → reserve  2 × Fruit 250g, 2 × Sprouts 150g, 2 × Juice 200ml
Order → PREPARING        → convert reservations to consumption
Cancel before PREPARING  → release all component reservations
Cancel at/after PREPARING→ write off all components as wastage
```

Stock is checked and reserved at component level, per component quantity × combo quantity.
A combo never has its own `inventory` row (doc 13 §2).

## 6. Combos in subscriptions

`subscription_items.combo_id` mirrors `cart_items.combo_id` and `order_items.combo_id`. At
materialisation the combo explodes into parent + components exactly as a one-time order does,
so nothing in the subscription engine needs combo-specific code.

If a component becomes unavailable mid-subscription, materialisation fails with
`COMBO_COMPONENT_UNAVAILABLE`, the delivery retries, and past cutoff it is marked `FAILED`
(EC-S4). Substituting a component automatically is deliberately not done: silently changing
what someone eats is unacceptable, especially with allergens in play.

## 7. Admin operations

| Action | Rule |
|---|---|
| Create combo | ≥ 2 components; every component an `ACTIVE` variant; `FIXED` mode requires a price |
| Add/remove component | Allowed while `DRAFT`. On an `ACTIVE` combo it takes effect for **new** orders only — existing orders keep their snapshot |
| Change price | Future orders only |
| Deactivate | Removed from storefront; existing orders and subscriptions honoured; subscriptions flagged |
| Delete | Soft delete; blocked while an active subscription references it (`409 COMBO_IN_USE`) |
| Duplicate | Convenience action for seasonal variants |

**Admin warnings shown on the combo editor:**
- Combo price ≥ component sum (no saving).
- A component is `OUT_OF_STOCK` or its product is inactive.
- A component variant is soft-deleted.
- `is_subscribable` is on but a component's product is not `is_subscribable`.

## 8. Business rules

| ID | Rule |
|---|---|
| BR-B1 | A combo contains ≥ 2 component variants. |
| BR-B2 | Components are **variants**, never products — so every purchase path resolves to the same leaf entity. |
| BR-B3 | A combo is available only if every component is available in the required quantity. |
| BR-B4 | Combo availability is always derived, never cached in a column. |
| BR-B5 | An order stores one priced parent line plus N zero-priced component lines. |
| BR-B6 | If the combo price ≥ the component sum, no savings badge is shown and admin is warned. |
| BR-B7 | Inventory is reserved, consumed and released at component level. |
| BR-B8 | Combo composition and price changes never alter existing orders or subscription snapshots. |
| BR-B9 | A combo has no inventory row of its own. |
| BR-B10 | A combo may not contain another combo (no nesting) — it would make pricing and availability recursive for no business gain. |

## 9. Storefront presence

Active combos appear automatically, with no manual publishing step, on:
- Marketing site: `/combos`, `/combos/[slug]`, and the homepage combo rail when `is_featured`.
- Customer app: the Combos tab, the home combo rail, and category pages where a component's
  category matches.
- Subscription plans that reference the combo.

Both surfaces read the same `/v1/public/combos` endpoint, so there is exactly one definition
of "active combo" in the system (doc 16 §5).

## 10. Future

| Feature | Phase | Note |
|---|---|---|
| Customer-configurable combos ("pick any 3 from this set") | P3 | Needs a `combo_slots` table with eligible-variant sets; the parent/component order model already supports it unchanged |
| Combo-level images per component | P2 | `product_images.variant_id` already allows it |
| Time-bound flash combos | P2 | `available_from` / `available_until` already exist |
| Combo bundles of combos | Not planned | BR-B10 |
