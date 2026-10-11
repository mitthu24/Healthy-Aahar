-- Phase 04: delivery-slot-only checkout (docs/09, docs/34 — zone/capacity
-- management is PHASE 06's real scope; this does not front-run it).
--
-- `orders.delivery_zone_id` was NOT NULL, forcing every order through a
-- `DeliveryZone` — but PHASE 06 ("Delivery Zones & Slots") has never
-- shipped an admin screen to create one, so checkout could not succeed in
-- any environment. The fix is additive and narrow: make the column
-- nullable so checkout can create an order with a delivery SLOT only,
-- leaving zone null. Nothing existing is renamed, dropped or back-filled;
-- `delivery_zones`, `slot_zone_assignments` and `slot_capacity` are left
-- exactly as they are for PHASE 06 to pick back up later.
--
-- ON DELETE RESTRICT -> SET NULL: now that the column is optional, a zone
-- being removed should null the reference on any order that happens to
-- have one, not block the delete — the same policy `addresses` and
-- `service_pincodes` already use for their own nullable zone references.

ALTER TABLE "orders" ALTER COLUMN "delivery_zone_id" DROP NOT NULL;

ALTER TABLE "orders" DROP CONSTRAINT "orders_delivery_zone_id_fkey";
ALTER TABLE "orders"
    ADD CONSTRAINT "orders_delivery_zone_id_fkey"
    FOREIGN KEY ("delivery_zone_id") REFERENCES "delivery_zones"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
