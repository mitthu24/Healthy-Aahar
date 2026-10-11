-- Fixes a real bug surfaced by CI's "Tests" job running checkout against a
-- real database for the first time in this project's history: every
-- checkout (and every order cancellation) has always raised
-- `inventory_movements_delta_non_zero` and 500'd, because the
-- ORDER_RESERVED / ORDER_RELEASED ledger rows checkout and cancellation
-- write are deliberately `quantity_delta = 0` (reserving/releasing stock
-- does not change `quantity_on_hand`, only `quantity_reserved` — that's
-- exactly what the dedicated `reserved_delta` column, already on this
-- table since PHASE 02, is for) but the original CHECK constraint forbade
-- `quantity_delta = 0` unconditionally, with no exception for a row that
-- legitimately records a reservation-only change via `reserved_delta`.
--
-- Narrowest possible fix: the constraint now requires EITHER delta to be
-- non-zero, so a genuine no-op row (both zero) is still rejected, but a
-- pure-reservation row is allowed. Nothing is dropped, renamed or
-- back-filled; no existing row is touched (the constraint only applies to
-- new/updated rows going forward).

ALTER TABLE "inventory_movements" DROP CONSTRAINT "inventory_movements_delta_non_zero";

ALTER TABLE "inventory_movements"
    ADD CONSTRAINT "inventory_movements_delta_non_zero"
    CHECK ("quantity_delta" <> 0 OR "reserved_delta" <> 0);
