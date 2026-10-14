-- Phase 05: employee "department" field on admin_users. Nullable,
-- additive-only — safe for existing rows, no backfill needed.
ALTER TABLE "admin_users" ADD COLUMN "department" TEXT;
