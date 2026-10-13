-- PHASE 06 — delivery-partner app + order assignment.
--
-- A delivery partner is an admin_users row with a restricted role (no new
-- user/session/auth table) plus this partner-only profile data. Assignment
-- is tracked both ways: a denormalized current-assignment pair of columns on
-- `orders` for fast reads, and an append-only `order_assignments` table for
-- the full history (same split as orders/order_status_history).

-- CreateEnum
CREATE TYPE "duty_status" AS ENUM ('ON_DUTY', 'OFF_DUTY');

-- CreateEnum
CREATE TYPE "assignment_status" AS ENUM ('ACTIVE', 'REASSIGNED', 'COMPLETED', 'CANCELLED');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN "assigned_partner_id" UUID;
ALTER TABLE "orders" ADD COLUMN "assigned_at" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "delivery_partner_profiles" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "admin_user_id" UUID NOT NULL,
    "duty_status" "duty_status" NOT NULL DEFAULT 'OFF_DUTY',
    "duty_changed_at" TIMESTAMPTZ(6),
    "vehicle_type" TEXT,
    "vehicle_number" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "delivery_partner_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_assignments" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "partner_admin_user_id" UUID NOT NULL,
    "assigned_by_user_id" UUID NOT NULL,
    "status" "assignment_status" NOT NULL DEFAULT 'ACTIVE',
    "reason" TEXT,
    "assigned_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(6),

    CONSTRAINT "order_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "delivery_partner_profiles_admin_user_id_key" ON "delivery_partner_profiles"("admin_user_id");

-- CreateIndex
CREATE INDEX "delivery_partner_profiles_business_id_duty_status_idx" ON "delivery_partner_profiles"("business_id", "duty_status");

-- CreateIndex
CREATE INDEX "order_assignments_order_id_assigned_at_idx" ON "order_assignments"("order_id", "assigned_at" DESC);

-- CreateIndex
CREATE INDEX "order_assignments_business_id_partner_admin_user_id_status_idx" ON "order_assignments"("business_id", "partner_admin_user_id", "status");

-- CreateIndex
CREATE INDEX "orders_assigned_partner_id_status_idx" ON "orders"("assigned_partner_id", "status");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_assigned_partner_id_fkey" FOREIGN KEY ("assigned_partner_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_partner_profiles" ADD CONSTRAINT "delivery_partner_profiles_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_partner_profiles" ADD CONSTRAINT "delivery_partner_profiles_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_assignments" ADD CONSTRAINT "order_assignments_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_assignments" ADD CONSTRAINT "order_assignments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_assignments" ADD CONSTRAINT "order_assignments_partner_admin_user_id_fkey" FOREIGN KEY ("partner_admin_user_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed the permission catalogue additions this phase needs. `delivery_partners:read`/
-- `delivery_partners:manage` were added to packages/core/src/domain/permissions.ts in
-- Phase 05 as prep but were never migrated into the DB — fixed here alongside the two
-- new keys this phase actually introduces. ON CONFLICT DO NOTHING mirrors migration
-- 20260921060000_phase03_seed_permissions.
INSERT INTO "permissions" ("id", "key", "resource", "action", "description", "created_at") VALUES
  (gen_random_uuid(), 'delivery_partners:read', 'delivery_partners', 'read', 'View delivery partner records and assignment status', now()),
  (gen_random_uuid(), 'delivery_partners:manage', 'delivery_partners', 'manage', 'Create, suspend and assign delivery partners', now()),
  (gen_random_uuid(), 'orders:assign', 'orders', 'assign', 'Assign or reassign an order to a delivery partner', now()),
  (gen_random_uuid(), 'deliveries:fulfil', 'deliveries', 'fulfil', 'Accept, update and complete deliveries assigned to you', now())
ON CONFLICT ("key") DO NOTHING;
