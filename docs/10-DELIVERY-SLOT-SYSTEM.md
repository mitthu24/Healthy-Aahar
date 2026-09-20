# 10 — Delivery Slot System

It answers one question precisely: **can this customer, at this address, order right now for
delivery on this date in this window?**

## 1. Purpose

The slot system is the constraint that makes a fresh-prep kitchen viable. It converts an
open-ended "deliver whenever" promise into a bounded, plannable commitment: a fixed number
of delivery stops, in a fixed window, ordered before a fixed cutoff.

It is the answer to four questions, and every other part of this document serves one of them:

1. **Where** do we deliver? — zones and pincodes
2. **When** do we deliver? — slots and their recurring windows
3. **By when** must an order arrive? — cutoffs
4. **How many** can we take? — capacity

## 2. Model

```
delivery_zones          "where we deliver"     — fee, minimum order, pincodes
  └── zone_pincodes
delivery_slots          "when we deliver"      — recurring rule: window, cutoff, days, capacity
  └── slot_zone_assignments   "which slots serve which zones"
slot_capacity           "one concrete bookable date"  — (slot, zone, date) → capacity, booked
business_holidays       "when we do not deliver"
```

The separation matters: a **slot** is a recurring rule that changes rarely; **capacity** is a
concrete, dated, contended resource that changes hundreds of times a day. Putting a booking
counter on `delivery_slots` would mean every checkout in the business contends on two rows.

## 3. Nothing is hard-coded

"Morning 06:00–08:00" and "Evening 17:00–19:00" are **seed data**, not constants. There is no
`MORNING`/`EVENING` enum, no `if (slot === 'morning')` anywhere in the codebase. The admin
can create "Late Night", delete "Evening", or run eight slots. The only structural assumption
is that a slot does not cross midnight (`CHECK (end_time > start_time)`); overnight windows
would need a date-offset column and are explicitly out of scope.

## 4. Cutoff

A cutoff is the last moment an order may be placed for a given `service_date` and slot. It is
expressed as a recurring rule:

```
cutoff_at(service_date) = (service_date − cutoff_days_before) at cutoff_time, in Asia/Kolkata
```

| Slot | `cutoff_time` | `cutoff_days_before` | Delivery 2026-09-22 | Cutoff |
|---|---|---|---|---|
| Morning 06:00–08:00 | 22:00 | 1 | Tue 22 Sep | **Mon 21 Sep 22:00 IST** |
| Evening 17:00–19:00 | 13:00 | 0 | Tue 22 Sep | **Tue 22 Sep 13:00 IST** |
| Morning (same-day, aggressive) | 04:00 | 0 | Tue 22 Sep | **Tue 22 Sep 04:00 IST** |

Two columns are the minimum expressive form: a single `TIME` cannot say "the night before",
and a single timestamp cannot express a recurring rule. `cutoff_at` is always computed on the
server and returned as an absolute UTC instant, so no client ever does timezone arithmetic
(BR-D3).

## 5. Availability algorithm

`isSlotBookable(slot, zone, serviceDate, now)` — evaluated in this order, returning the
**first** failing reason so the UI can explain itself:

```
1. slot.is_active and not soft-deleted            → SLOT_INACTIVE
2. zone.is_active and serves this slot            → ZONE_NOT_SERVED
3. ISO weekday(serviceDate) ∈ slot.available_days → NOT_AVAILABLE_ON_DAY
4. no matching business_holidays row              → HOLIDAY
5. serviceDate within [today, today + horizon]    → OUTSIDE_BOOKING_WINDOW
6. now < cutoff_at(serviceDate)                   → CUTOFF_PASSED
7. slot_capacity row not is_blocked               → SLOT_BLOCKED
8. booked_count < capacity                        → SLOT_FULL
                                                  → AVAILABLE
```

Unavailable slots are **returned, not hidden** (doc 06 §7). A slot that silently disappears
reads as a broken app; "Fully booked — try Evening" converts.

### Worked example
Now: **Mon 21 Sep 2026, 14:30 IST**. Horizon 7 days.

| Date | Slot | Evaluation | Result |
|---|---|---|---|
| Mon 21 | Morning | cutoff was Sun 20 22:00 | `CUTOFF_PASSED` |
| Mon 21 | Evening | cutoff Mon 21 13:00 — passed at 14:30 | `CUTOFF_PASSED` |
| Tue 22 | Morning | cutoff Mon 21 22:00 — 7.5h remain; 34/60 booked | **AVAILABLE** |
| Tue 22 | Evening | cutoff Tue 22 13:00; 60/60 booked | `SLOT_FULL` |
| Sun 27 | Morning | `available_days = {1,2,3,4,5}`, Sunday = 7 | `NOT_AVAILABLE_ON_DAY` |
| Fri 2 Oct | Morning | Gandhi Jayanti in `business_holidays` | `HOLIDAY` |

Earliest bookable: **Tue 22 Sep, Morning**.

## 6. Capacity

### 6.1 Rows are created ahead of demand
`roll-slot-capacity` runs at 00:30 IST and ensures a `slot_capacity` row exists for every
(active slot × assigned zone × date) across the booking horizon, seeded from
`slot_zone_assignments.capacity_override ?? delivery_slots.default_capacity`.

Creating rows lazily at checkout would mean the first customer of the day pays an extra
insert inside the hot transaction, and two simultaneous first-customers would race on the
unique index. Pre-creating removes both problems; the unique key makes the job itself
idempotent (`ON CONFLICT DO NOTHING`).

### 6.2 Booking is a locked increment

```sql
BEGIN;
SELECT capacity, booked_count, is_blocked
  FROM slot_capacity
 WHERE delivery_slot_id = $1 AND delivery_zone_id = $2 AND service_date = $3
   FOR UPDATE;                                    -- serialisation point

-- assert not blocked and booked_count < capacity, else abort

UPDATE slot_capacity
   SET booked_count = booked_count + 1, updated_at = now()
 WHERE id = $4;
-- CHECK (booked_count <= capacity) is the database's own backstop
COMMIT;
```

Two guarantees, deliberately layered:
1. **Application** — the `FOR UPDATE` read plus the assertion gives a clean 409 with a
   helpful message.
2. **Database** — `CHECK (booked_count >= 0 AND booked_count <= capacity)` means that even a
   buggy new code path cannot over-book. It fails the transaction instead.

The second layer is what turns "we believe over-booking is impossible" into "over-booking is
impossible" (BR-D6, NFR-4).

### 6.3 Capacity counts orders, not items
One order consumes one unit of capacity regardless of basket size, because capacity models
**delivery stops**, which is what the delivery run is constrained by. Kitchen throughput is
constrained by **inventory**, which is tracked separately. Conflating the two would make a
single 20-item order block 20 households.

### 6.4 Capacity is released on cancellation
Any cancellation, at any stage, decrements `booked_count` in the same transaction. The food
may be wasted (BR-O6), but the delivery stop is genuinely free and should be resold.

### 6.5 Reserved subscription capacity (P2)
`reserved_for_subscriptions` exists in the schema now and is zero at MVP. When enabled,
one-time orders are limited to `capacity − reserved_for_subscriptions`, while subscription
materialisation may use the full capacity. This prevents a promotion from crowding out the
customers who have committed to a standing order — the worst possible failure for a
subscription business. Shipping the column now means enabling it later is a settings change,
not a migration.

## 7. Zones and serviceability

- A pincode maps to **exactly one** zone (`UNIQUE (business_id, pincode)`), which makes
  resolution deterministic and cache-friendly.
- `addresses.delivery_zone_id` is cached on save and **re-resolved at checkout**, because
  zone boundaries change and a stale cache must never determine what someone is charged
  (EC-D4).
- Non-serviceable is answered with `200 { is_serviceable: false }` plus a waitlist prompt —
  a demand signal for expansion, and a 404 would be semantically wrong.
- Splitting one pincode across zones requires geo-polygons and is explicitly Phase 3.

### Fee and minimum resolution
Slot-level values override zone-level values when present:
```
delivery_fee     = slot.delivery_fee_paise     ?? zone.delivery_fee_paise
min_order_value  = slot.min_order_value_paise  ?? zone.min_order_value_paise
fee waived when  subtotal >= zone.free_delivery_above_paise
```
This ordering lets a premium early-morning slot carry a surcharge without redefining the zone
(BR-D9).

## 8. Holidays and blackouts

Two mechanisms with different lifetimes:

| Mechanism | Scope | Use |
|---|---|---|
| `business_holidays` | Planned, recurring-ish, whole day or a specific slot/zone | Festivals, annual closures |
| `slot_capacity.is_blocked` | One concrete (slot, zone, date) | Today's van broke down |

Both are consulted by slot availability **and** by the subscription generator, so a holiday
declared today automatically removes tomorrow's subscription deliveries rather than creating
orders nobody can fulfil (EC-D1).

**Declaring a holiday for a date that already has orders** does **not** auto-cancel them —
it returns a warning with the affected count and requires an explicit second action. Silent
mass-cancellation of committed orders is never the right default.

## 9. Booking horizon

`booking.horizon_days` in `settings`, default **7**.

| Horizon | Trade-off |
|---|---|
| 1–2 days | Minimal wastage risk, but no forward demand signal for procurement |
| **7 days** | **Chosen.** One week of visible demand for buying produce; short enough that price and availability stay honest |
| 30 days | False precision for perishables; invites cancellations and price drift |

Subscriptions use a **separate, longer** generation horizon
(`subscription.generation_horizon_days`, default 14) so customers can see two weeks of
upcoming deliveries. Those deliveries only *materialise into orders* within a short window
(`subscription.materialise_horizon_hours`, default 36), so subscription capacity is consumed
at the same time as everyone else's (BR-S8).

## 10. Time handling rules

1. `service_date` is a bare `DATE`, always in `Asia/Kolkata`.
2. `start_time`, `end_time` and `cutoff_time` are bare `TIME`, always `Asia/Kolkata`.
3. All instants (`cutoff_at`, `placed_at`) are `TIMESTAMPTZ` in UTC.
4. Conversion happens in exactly one module, `packages/core/src/domain/time.ts`.
5. The API returns both `"cutoff_at": "2026-09-21T16:30:00Z"` (machine) and
   `"cutoff_label": "Today, 10:00 PM"` (human, pre-formatted in IST).
6. Clients never compute a cutoff. A device with a wrong clock or a traveller in another
   timezone must see the same answer as the kitchen.
7. India does not observe DST, but the code uses a real timezone library rather than a fixed
   `+05:30` offset, so a second city in a DST zone would not require rewriting date logic.

## 11. Business rules

| ID | Rule |
|---|---|
| BR-D1 | Serviceability is enforced once, at checkout. Saving an unserviceable address is allowed. |
| BR-D2 | A pincode belongs to exactly one zone. |
| BR-D3 | `cutoff_at = (service_date − cutoff_days_before) @ cutoff_time` in the business timezone. |
| BR-D4 | Orders cannot be placed after `cutoff_at`. |
| BR-D5 | A slot is bookable on a date only if that ISO weekday is in `available_days`. |
| BR-D6 | `booked_count` may never exceed `capacity`. Enforced by row lock **and** `CHECK`. |
| BR-D7 | One order = one unit of capacity, regardless of item count. |
| BR-D8 | Holidays and blackouts suppress both new orders and subscription generation. |
| BR-D9 | Slot-level fee and minimum override zone-level values when set. |
| BR-D10 | Cancellation releases capacity at any stage. |
| BR-D11 | A slot with future orders or active subscriptions cannot be deleted; it can be deactivated, which stops new bookings while honouring existing ones. |
| BR-D12 | Changing `default_capacity` affects only **future** `slot_capacity` rows; today's row keeps its value unless explicitly overridden. |
| BR-D13 | Reducing a date's capacity below its current `booked_count` is rejected; existing orders are never invalidated by a configuration change. |

## 12. Admin operations

| Action | Effect |
|---|---|
| Create slot | Capacity rows appear for the horizon on the next roll (or immediately on demand) |
| Edit window/cutoff | Future dates only; today's orders keep their snapshot |
| Deactivate slot | No new bookings; existing orders and subscriptions honoured; subscriptions on that slot are flagged for reassignment |
| Delete slot | Blocked while in use → `409 SLOT_IN_USE` with counts |
| Block one date | `slot_capacity.is_blocked = true`; existing orders warned about, not cancelled |
| Override one date's capacity | Direct `PATCH`; cannot go below `booked_count` |
| Declare a holiday | Suppresses future generation; warns about existing orders |

## 13. Monitoring

| Metric | Why | Alert |
|---|---|---|
| Slot utilisation % by slot/date/zone | Demand vs capacity | > 90% for 3 consecutive days → consider raising capacity |
| `SLOT_FULL` rejections | Lost revenue, invisible in order data | > 20/day |
| Cutoff-passed rejections | Cutoff may be too early | Weekly review |
| Capacity rows missing for tomorrow | The roll job failed | **Page immediately** |
| Slot adherence % | Are we keeping the promise | < 90% |
