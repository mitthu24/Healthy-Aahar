# 13 — Inventory System

## 1. What inventory means for fresh food

This is not warehouse inventory. Stock is prepared daily, has a shelf life measured in hours,
and is often made to order. The MVP model is therefore deliberately modest: an accurate
count, an honest ledger, and a hard guarantee that we never sell what we cannot make. The
perishability machinery (batches, expiry, FEFO) is designed now and built in Phase 2, when
there is real wastage data to justify it.

## 2. Model

```
product_variant ──1:0..1── inventory (per location_code)
                              │
                              └──< inventory_movements   (append-only ledger)
```

- Inventory attaches to **variants**, never to products or combos. A combo's stock is the
  stock of its components (doc 12 §5).
- `location_code` defaults to `'MAIN'`. It exists so a second kitchen is a new row, not a
  migration.
- **`quantity_available = quantity_on_hand − quantity_reserved` is always computed.** Storing
  it would create a third number capable of disagreeing with the other two, and the bug would
  surface as overselling.

### Three numbers

| Number | Meaning | Changed by |
|---|---|---|
| `quantity_on_hand` | Physically present | Production, adjustment, consumption, wastage |
| `quantity_reserved` | Promised to placed-but-not-yet-prepared orders | Order placement, cancellation, consumption |
| `quantity_available` | Sellable right now (derived) | — |

### Availability vs stock, again
`product_variants.availability` is **editorial** ("we are not selling this"), `inventory` is
**quantitative**. Both must pass. This is what lets the kitchen manager pull an item for a
quality reason at 05:00 without corrupting the count (BR-C4).

`inventory.track_inventory = false` means "made to order, unlimited" — the common case for
items assembled fresh from bulk produce. Such variants never block a sale and never appear in
low-stock reports. This flag is what keeps the model from becoming a burden on a business
that does not want to count individual salads.

## 3. Reservation lifecycle

```
Cart                    no effect                       — carts reserve nothing
Order placed            reserved += n                   ORDER_RESERVED
Order → PREPARING       on_hand -= n, reserved -= n     ORDER_CONSUMED
Order cancelled (pre-PREPARING)   reserved -= n         ORDER_RELEASED
Order cancelled (post-PREPARING)  on_hand -= n          WASTAGE (already made)
Order FAILED delivery   on_hand -= n                    WASTAGE
Stock added             on_hand += n                    PRODUCTION / PURCHASE
Manual correction       on_hand ±= n                    MANUAL_ADJUSTMENT / STOCK_TAKE
```

**Why carts do not reserve:** a fresh-food cart is often open for minutes or abandoned for
days. Reserving on add-to-cart would make a handful of abandoned carts starve real orders,
and would demand a reservation-expiry system nobody asked for. The cost is a small race
window between viewing and ordering — handled by re-checking stock inside the order
transaction, where the row is locked (BR-I2).

**Why consumption happens at `PREPARING`, not at placement:** until the kitchen starts, the
food does not exist and the order is freely cancellable. `PREPARING` is the moment the
business commits produce, which is exactly what `quantity_on_hand` should track.

## 4. The ledger

Every change to `inventory` writes an `inventory_movements` row **in the same transaction**.
No exceptions, including admin adjustments and system corrections.

```
reason            delta  reserved_delta  after  reference
PRODUCTION         +50         0           50   stock_take:...
ORDER_RESERVED       0        +2           50   order:HL-2026-0001842
ORDER_CONSUMED      -2        -2           48   order:HL-2026-0001842
WASTAGE             -3         0           45   order:HL-2026-0001799
MANUAL_ADJUSTMENT   -1         0           44   note: "dropped"
```

`quantity_after` is stored on every movement so the ledger is auditable without replaying it
from the beginning, and so a discrepancy can be bisected to the exact movement that caused
it. A nightly reconciliation asserts `Σ quantity_delta == quantity_on_hand` per variant and
alerts on mismatch — if that alert ever fires, there is a code path mutating inventory
outside the service layer, which is a bug worth paging for.

**Every adjustment requires a `reason`.** Unexplained stock changes are a governance failure,
not a convenience, and the enum forces the person to categorise it. Wastage in particular is
a number this business needs.

## 5. Concurrency

```sql
BEGIN;
SELECT quantity_on_hand, quantity_reserved, track_inventory, allow_backorder
  FROM inventory
 WHERE variant_id = ANY($1) AND location_code = 'MAIN'
 ORDER BY variant_id            -- fixed lock order prevents deadlock
   FOR UPDATE;

-- per variant: track_inventory AND (on_hand - reserved) < needed → 409 INSUFFICIENT_STOCK

UPDATE inventory SET quantity_reserved = quantity_reserved + $n WHERE id = $id;
INSERT INTO inventory_movements (...);
COMMIT;
```

Locks are taken in ascending `variant_id` order, and the global lock hierarchy is
`slot_capacity → inventory → orders` (doc 04 §14). A fixed order is what makes deadlocks
structurally impossible rather than intermittently painful.

`CHECK (quantity_on_hand >= 0)` and
`CHECK (quantity_reserved <= quantity_on_hand OR allow_backorder)` are the database-level
backstop: a new code path that forgets the application check fails its transaction rather
than producing negative stock.

## 6. Admin experience

**Inventory list** — variant, product, on hand, reserved, available, threshold, status
badge, last movement. Filters: low stock, out of stock, tracked/untracked, category.
Status is derived: `OUT_OF_STOCK` when available ≤ 0, `LOW_STOCK` when
available ≤ `low_stock_threshold`, else `IN_STOCK`.

**Daily flow the UI must support in under a minute:**
1. Morning: enter today's prepared quantities (bulk "set on hand" form).
2. During the day: mark an item out of stock when produce runs out (single tap — the most
   time-critical action in the business, available to `INVENTORY_MANAGER`).
3. Evening: record wastage against unsold prepared stock.

**Bulk adjust** accepts a list of `(variant_id, quantity_delta, reason, note)` and applies
them in one transaction with one audit entry — because the morning stock entry is a single
operational act, not twenty.

## 7. Business rules

| ID | Rule |
|---|---|
| BR-I1 | Inventory attaches to variants only. |
| BR-I2 | Carts never reserve stock; orders do. |
| BR-I3 | Reservation happens at order placement, inside the order transaction. |
| BR-I4 | Consumption happens at `PREPARING`. |
| BR-I5 | Cancellation before `PREPARING` releases; at or after `PREPARING` writes off as wastage. |
| BR-I6 | `quantity_available` is always derived. |
| BR-I7 | Every inventory change writes a movement in the same transaction. |
| BR-I8 | Every manual adjustment requires a reason. |
| BR-I9 | `track_inventory = false` never blocks a sale. |
| BR-I10 | Stock may not go negative unless `allow_backorder` is explicitly set. |
| BR-I11 | Combo stock is component stock; combos have no inventory row. |
| BR-I12 | A stock change never retroactively alters a placed order. |
| BR-I13 | Setting a variant `OUT_OF_STOCK` stops new sales immediately but does not cancel existing orders. |

## 8. Low stock and alerts

| Alert | Trigger | Recipient |
|---|---|---|
| Low stock | available ≤ threshold | Admin dashboard widget |
| Out of stock | available ≤ 0 on a tracked variant | Dashboard + email to `INVENTORY_MANAGER` |
| Subscription at risk | tomorrow's subscription demand > available | Dashboard exception list — **the most valuable alert in the system**, because it prevents a promised delivery from failing |
| Ledger mismatch | nightly reconciliation fails | Engineering alert |

The subscription-demand alert is computed by summing tomorrow's `SCHEDULED` deliveries'
component quantities and comparing against available stock. Catching a shortfall at 20:00 the
night before means the kitchen can buy more produce; catching it at 06:00 means a customer
gets nothing.

## 9. Phase 2 — perishables

Fresh food needs batches. The model is specified now so that today's code is written against
an aggregate it will not have to abandon.

```
inventory (aggregate — unchanged)
   └──< inventory_batches
          batch_code, prepared_at, best_before_at,
          quantity_received, quantity_remaining, cost_per_unit_paise, status
inventory_movements gains a nullable batch_id
```

- Consumption is **FEFO** (first-expiring, first-out).
- `inventory.quantity_on_hand` becomes the sum of non-expired batch remainders, maintained
  transactionally.
- An `expire-batches` job moves past-best-before quantities to `EXPIRY` wastage nightly.
- Wastage reporting gains cost attribution, which is the number that justifies the feature.

**Nothing in the MVP schema blocks this.** `inventory` stays the aggregate; batches become
its detail; existing movements simply have `batch_id = NULL`.

## 10. Reporting

| Report | Phase |
|---|---|
| Current stock and valuation | MVP |
| Movement history per variant | MVP |
| Wastage by reason and period | MVP (quantity) / P2 (cost) |
| Stock-out incidents and lost demand | P2 |
| Demand forecast from subscriptions | P2 — the highest-value analytic, since subscription demand is known days in advance |
| Batch-level wastage and shelf-life analysis | P2 |
| Supplier and purchase costing | FUT |
