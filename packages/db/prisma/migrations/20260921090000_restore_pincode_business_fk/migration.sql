-- Restore the composite foreign key that keeps a pincode inside its own
-- business.
--
-- WHY THIS MIGRATION EXISTS
--
-- Phase 01 created this constraint in hand-written SQL only. The Prisma
-- schema modelled the relation as a plain `city_id` FK, so when
-- `prisma migrate diff` generated the Phase 02 migration it reconciled the
-- database down to the model and SILENTLY DROPPED the composite key —
-- removing the guarantee that a pincode cannot be attached to another
-- business's city (BR-SV3).
--
-- An integration test caught it. The schema now declares the composite
-- relation, so a future diff cannot drop it again; this migration repairs
-- databases that already ran the Phase 02 migration.
--
-- The lesson, recorded in ADR-032: a constraint that exists only in raw SQL
-- is invisible to the diff engine and will eventually be reverted. Anything
-- Prisma CAN model must be modelled.

ALTER TABLE "service_pincodes" DROP CONSTRAINT IF EXISTS "service_pincodes_city_id_fkey";

ALTER TABLE "service_pincodes"
    ADD CONSTRAINT "service_pincodes_city_id_business_id_fkey"
        FOREIGN KEY ("city_id", "business_id") REFERENCES "cities"("id", "business_id")
        ON DELETE RESTRICT ON UPDATE CASCADE;
