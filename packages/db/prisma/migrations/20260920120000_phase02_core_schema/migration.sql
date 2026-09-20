-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "btree_gin";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "citext";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateEnum
CREATE TYPE "user_type" AS ENUM ('CUSTOMER', 'ADMIN');

-- CreateEnum
CREATE TYPE "product_status" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "availability_state" AS ENUM ('AVAILABLE', 'OUT_OF_STOCK', 'DISCONTINUED');

-- CreateEnum
CREATE TYPE "order_status" AS ENUM ('PENDING', 'CONFIRMED', 'PREPARING', 'READY_FOR_DISPATCH', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED', 'FAILED', 'RETURNED');

-- CreateEnum
CREATE TYPE "order_source" AS ENUM ('ONE_TIME', 'SUBSCRIPTION');

-- CreateEnum
CREATE TYPE "order_channel" AS ENUM ('WEB', 'MOBILE', 'ADMIN', 'SYSTEM');

-- CreateEnum
CREATE TYPE "cancel_actor" AS ENUM ('CUSTOMER', 'ADMIN', 'SYSTEM');

-- CreateEnum
CREATE TYPE "payment_method" AS ENUM ('COD', 'ONLINE', 'WALLET', 'CREDIT');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('DUE', 'AUTHORIZED', 'PAID', 'PARTIALLY_REFUNDED', 'REFUNDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "refund_status" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "subscription_status" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'CANCELLED', 'EXPIRED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "sub_delivery_status" AS ENUM ('SCHEDULED', 'SKIPPED', 'ORDER_CREATED', 'FULFILLED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "frequency_type" AS ENUM ('DAILY', 'WEEKLY', 'CUSTOM_DAYS', 'ALTERNATE_DAYS', 'MONTHLY');

-- CreateEnum
CREATE TYPE "inventory_reason" AS ENUM ('PURCHASE', 'PRODUCTION', 'ORDER_RESERVED', 'ORDER_RELEASED', 'ORDER_CONSUMED', 'MANUAL_ADJUSTMENT', 'WASTAGE', 'DAMAGE', 'RETURN', 'EXPIRY', 'STOCK_TAKE');

-- CreateEnum
CREATE TYPE "notification_channel" AS ENUM ('IN_APP', 'EMAIL', 'WHATSAPP', 'PUSH', 'SMS');

-- CreateEnum
CREATE TYPE "outbox_status" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'DEAD');

-- CreateEnum
CREATE TYPE "discount_type" AS ENUM ('PERCENTAGE', 'FIXED');

-- CreateEnum
CREATE TYPE "image_status" AS ENUM ('PENDING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "idempotency_status" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "review_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- DropForeignKey
ALTER TABLE "service_pincodes" DROP CONSTRAINT "service_pincodes_city_same_business_fkey";

-- AlterTable
ALTER TABLE "service_pincodes" ADD COLUMN     "delivery_zone_id" UUID;

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "business_id" UUID,
    "actor_user_id" UUID,
    "actor_type" TEXT NOT NULL,
    "actor_email" CITEXT,
    "action" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" UUID,
    "before" JSONB,
    "after" JSONB,
    "metadata" JSONB,
    "ip_address" INET,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "firebase_uid" TEXT NOT NULL,
    "user_type" "user_type" NOT NULL,
    "email" CITEXT,
    "phone" TEXT,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "phone_verified" BOOLEAN NOT NULL DEFAULT false,
    "status" "account_status" NOT NULL DEFAULT 'ACTIVE',
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_profiles" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "first_name" TEXT,
    "last_name" TEXT,
    "display_name" TEXT,
    "date_of_birth" DATE,
    "gender" TEXT,
    "default_address_id" UUID,
    "preferred_slot_id" UUID,
    "marketing_opt_in" BOOLEAN NOT NULL DEFAULT false,
    "total_orders" INTEGER NOT NULL DEFAULT 0,
    "lifetime_value_paise" BIGINT NOT NULL DEFAULT 0,
    "first_order_at" TIMESTAMPTZ(6),
    "last_order_at" TIMESTAMPTZ(6),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "customer_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_users" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "employee_code" TEXT,
    "designation" TEXT,
    "is_super_admin" BOOLEAN NOT NULL DEFAULT false,
    "mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
    "last_password_change_at" TIMESTAMPTZ(6),
    "invited_by" UUID,
    "invitation_accepted_at" TIMESTAMPTZ(6),
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "key" CITEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "key" CITEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "admin_user_roles" (
    "admin_user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "granted_by" UUID,
    "granted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_user_roles_pkey" PRIMARY KEY ("admin_user_id","role_id")
);

-- CreateTable
CREATE TABLE "addresses" (
    "id" UUID NOT NULL,
    "customer_profile_id" UUID NOT NULL,
    "label" TEXT,
    "recipient_name" TEXT NOT NULL,
    "recipient_phone" TEXT NOT NULL,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "landmark" TEXT,
    "city" TEXT NOT NULL,
    "city_id" UUID,
    "state" TEXT NOT NULL,
    "pincode" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'IN',
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "delivery_zone_id" UUID,
    "delivery_instructions" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "parent_id" UUID,
    "name" TEXT NOT NULL,
    "slug" CITEXT NOT NULL,
    "description" TEXT,
    "image_url" TEXT,
    "icon_url" TEXT,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "seo_title" TEXT,
    "seo_description" TEXT,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" CITEXT NOT NULL,
    "short_description" TEXT,
    "description" TEXT,
    "status" "product_status" NOT NULL DEFAULT 'DRAFT',
    "is_subscribable" BOOLEAN NOT NULL DEFAULT false,
    "is_featured" BOOLEAN NOT NULL DEFAULT false,
    "is_bestseller" BOOLEAN NOT NULL DEFAULT false,
    "is_new" BOOLEAN NOT NULL DEFAULT false,
    "popularity_score" INTEGER NOT NULL DEFAULT 0,
    "ingredients" TEXT,
    "nutrition" JSONB,
    "allergens" TEXT[],
    "preparation_note" TEXT,
    "storage_note" TEXT,
    "shelf_life_hours" INTEGER,
    "dietary_tags" TEXT[],
    "seo_title" TEXT,
    "seo_description" TEXT,
    "search_vector" tsvector,
    "published_at" TIMESTAMPTZ(6),
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variants" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "sku" CITEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "unit_value" DECIMAL(10,3) NOT NULL,
    "mrp_paise" BIGINT,
    "price_paise" BIGINT NOT NULL,
    "subscription_price_paise" BIGINT,
    "cost_paise" BIGINT,
    "tax_rate_bps" INTEGER NOT NULL DEFAULT 0,
    "availability" "availability_state" NOT NULL DEFAULT 'AVAILABLE',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "max_order_quantity" INTEGER,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_images" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID,
    "storage_key" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "alt_text" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "blur_data_url" TEXT,
    "status" "image_status" NOT NULL DEFAULT 'PENDING',
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "product_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "key" CITEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'MERCH',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_tags" (
    "product_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,

    CONSTRAINT "product_tags_pkey" PRIMARY KEY ("product_id","tag_id")
);

-- CreateTable
CREATE TABLE "combos" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" CITEXT NOT NULL,
    "short_description" TEXT,
    "description" TEXT,
    "image_url" TEXT,
    "pricing_mode" TEXT NOT NULL DEFAULT 'FIXED',
    "price_paise" BIGINT,
    "discount_type" "discount_type",
    "discount_value" INTEGER,
    "subscription_price_paise" BIGINT,
    "status" "product_status" NOT NULL DEFAULT 'DRAFT',
    "is_subscribable" BOOLEAN NOT NULL DEFAULT false,
    "is_featured" BOOLEAN NOT NULL DEFAULT false,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "available_from" DATE,
    "available_until" DATE,
    "seo_title" TEXT,
    "seo_description" TEXT,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "combos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "combo_items" (
    "id" UUID NOT NULL,
    "combo_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "display_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "combo_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_zone_availability" (
    "id" UUID NOT NULL,
    "variant_id" UUID,
    "combo_id" UUID,
    "delivery_zone_id" UUID NOT NULL,
    "is_available" BOOLEAN NOT NULL DEFAULT true,
    "price_override_paise" BIGINT,

    CONSTRAINT "product_zone_availability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_zones" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "city_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" CITEXT NOT NULL,
    "delivery_fee_paise" BIGINT NOT NULL DEFAULT 0,
    "free_delivery_above_paise" BIGINT,
    "min_order_value_paise" BIGINT NOT NULL DEFAULT 0,
    "max_daily_orders" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "delivery_zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_slots" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" CITEXT NOT NULL,
    "start_time" TIME(6) NOT NULL,
    "end_time" TIME(6) NOT NULL,
    "cutoff_time" TIME(6) NOT NULL,
    "cutoff_days_before" INTEGER NOT NULL DEFAULT 0,
    "available_days" SMALLINT[],
    "default_capacity" INTEGER NOT NULL,
    "delivery_fee_paise" BIGINT,
    "min_order_value_paise" BIGINT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "delivery_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slot_zone_assignments" (
    "id" UUID NOT NULL,
    "delivery_slot_id" UUID NOT NULL,
    "delivery_zone_id" UUID NOT NULL,
    "capacity_override" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "slot_zone_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slot_capacity" (
    "id" UUID NOT NULL,
    "delivery_slot_id" UUID NOT NULL,
    "delivery_zone_id" UUID NOT NULL,
    "service_date" DATE NOT NULL,
    "capacity" INTEGER NOT NULL,
    "reserved_for_subscriptions" INTEGER NOT NULL DEFAULT 0,
    "booked_count" INTEGER NOT NULL DEFAULT 0,
    "is_blocked" BOOLEAN NOT NULL DEFAULT false,
    "block_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "slot_capacity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_holidays" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "holiday_date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "delivery_zone_id" UUID,
    "delivery_slot_id" UUID,
    "is_full_closure" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_holidays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carts" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "customer_profile_id" UUID NOT NULL,
    "delivery_address_id" UUID,
    "delivery_slot_id" UUID,
    "service_date" DATE,
    "coupon_code" TEXT,
    "last_activity_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "carts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cart_items" (
    "id" UUID NOT NULL,
    "cart_id" UUID NOT NULL,
    "variant_id" UUID,
    "combo_id" UUID,
    "quantity" INTEGER NOT NULL,
    "added_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cart_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "order_number" TEXT NOT NULL,
    "customer_profile_id" UUID NOT NULL,
    "status" "order_status" NOT NULL DEFAULT 'PENDING',
    "source" "order_source" NOT NULL DEFAULT 'ONE_TIME',
    "channel" "order_channel" NOT NULL DEFAULT 'WEB',
    "subscription_id" UUID,
    "subscription_delivery_id" UUID,
    "delivery_zone_id" UUID NOT NULL,
    "delivery_slot_id" UUID NOT NULL,
    "service_date" DATE NOT NULL,
    "slot_start_time" TIME(6) NOT NULL,
    "slot_end_time" TIME(6) NOT NULL,
    "slot_name_snapshot" TEXT NOT NULL,
    "address_id" UUID,
    "address_snapshot" JSONB NOT NULL,
    "customer_name_snapshot" TEXT NOT NULL,
    "customer_phone_snapshot" TEXT NOT NULL,
    "subtotal_paise" BIGINT NOT NULL,
    "discount_paise" BIGINT NOT NULL DEFAULT 0,
    "delivery_fee_paise" BIGINT NOT NULL DEFAULT 0,
    "tax_paise" BIGINT NOT NULL DEFAULT 0,
    "total_paise" BIGINT NOT NULL,
    "coupon_code" TEXT,
    "payment_method" "payment_method" NOT NULL DEFAULT 'COD',
    "payment_status" "payment_status" NOT NULL DEFAULT 'DUE',
    "customer_note" TEXT,
    "internal_note" TEXT,
    "cancelled_at" TIMESTAMPTZ(6),
    "cancelled_by_type" "cancel_actor",
    "cancelled_by_user_id" UUID,
    "cancellation_reason" TEXT,
    "confirmed_at" TIMESTAMPTZ(6),
    "prepared_at" TIMESTAMPTZ(6),
    "dispatched_at" TIMESTAMPTZ(6),
    "delivered_at" TIMESTAMPTZ(6),
    "placed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "variant_id" UUID,
    "combo_id" UUID,
    "parent_item_id" UUID,
    "product_name_snapshot" TEXT NOT NULL,
    "variant_name_snapshot" TEXT,
    "sku_snapshot" TEXT,
    "image_url_snapshot" TEXT,
    "unit" TEXT,
    "unit_value" DECIMAL(10,3),
    "quantity" INTEGER NOT NULL,
    "unit_price_paise" BIGINT NOT NULL,
    "mrp_paise" BIGINT,
    "discount_paise" BIGINT NOT NULL DEFAULT 0,
    "tax_rate_bps" INTEGER NOT NULL DEFAULT 0,
    "tax_paise" BIGINT NOT NULL DEFAULT 0,
    "line_total_paise" BIGINT NOT NULL,
    "is_component" BOOLEAN NOT NULL DEFAULT false,
    "fulfilment_status" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_status_history" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "from_status" "order_status",
    "to_status" "order_status" NOT NULL,
    "actor_type" TEXT NOT NULL,
    "actor_user_id" UUID,
    "reason" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "status" "idempotency_status" NOT NULL DEFAULT 'IN_PROGRESS',
    "response_status" INTEGER,
    "response_body" JSONB,
    "resource_id" UUID,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_plans" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" CITEXT NOT NULL,
    "description" TEXT,
    "image_url" TEXT,
    "frequency_type" "frequency_type" NOT NULL,
    "allowed_days" SMALLINT[],
    "default_days" SMALLINT[],
    "discount_type" "discount_type",
    "discount_value" INTEGER,
    "min_duration_days" INTEGER,
    "max_duration_days" INTEGER,
    "max_pause_days_per_month" INTEGER,
    "max_skips_per_month" INTEGER,
    "pause_notice_hours" INTEGER NOT NULL DEFAULT 0,
    "cancellation_notice_hours" INTEGER NOT NULL DEFAULT 0,
    "allow_slot_change" BOOLEAN NOT NULL DEFAULT true,
    "allow_quantity_change" BOOLEAN NOT NULL DEFAULT true,
    "allowed_slot_ids" UUID[],
    "status" "product_status" NOT NULL DEFAULT 'DRAFT',
    "is_featured" BOOLEAN NOT NULL DEFAULT false,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "subscription_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_plan_items" (
    "id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "variant_id" UUID,
    "combo_id" UUID,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "is_quantity_editable" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "subscription_plan_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "subscription_number" TEXT NOT NULL,
    "customer_profile_id" UUID NOT NULL,
    "subscription_plan_id" UUID,
    "status" "subscription_status" NOT NULL DEFAULT 'ACTIVE',
    "frequency_type" "frequency_type" NOT NULL,
    "delivery_days" SMALLINT[],
    "interval_days" INTEGER,
    "delivery_slot_id" UUID NOT NULL,
    "address_id" UUID NOT NULL,
    "delivery_zone_id" UUID NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "next_delivery_date" DATE,
    "last_delivery_date" DATE,
    "paused_at" TIMESTAMPTZ(6),
    "pause_until_date" DATE,
    "pause_reason" TEXT,
    "resumed_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "cancelled_by_type" "cancel_actor",
    "cancellation_reason" TEXT,
    "price_per_delivery_paise" BIGINT NOT NULL,
    "delivery_fee_paise" BIGINT NOT NULL DEFAULT 0,
    "payment_method" "payment_method" NOT NULL DEFAULT 'COD',
    "total_deliveries_count" INTEGER NOT NULL DEFAULT 0,
    "total_skipped_count" INTEGER NOT NULL DEFAULT 0,
    "generated_until_date" DATE,
    "customer_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_items" (
    "id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "variant_id" UUID,
    "combo_id" UUID,
    "quantity" INTEGER NOT NULL,
    "unit_price_paise" BIGINT NOT NULL,
    "product_name_snapshot" TEXT NOT NULL,
    "variant_name_snapshot" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "subscription_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_deliveries" (
    "id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "delivery_date" DATE NOT NULL,
    "delivery_slot_id" UUID NOT NULL,
    "address_id" UUID NOT NULL,
    "status" "sub_delivery_status" NOT NULL DEFAULT 'SCHEDULED',
    "order_id" UUID,
    "expected_total_paise" BIGINT NOT NULL,
    "skipped_at" TIMESTAMPTZ(6),
    "skipped_by_type" "cancel_actor",
    "skip_reason" TEXT,
    "failure_reason" TEXT,
    "materialised_at" TIMESTAMPTZ(6),
    "reminder_sent_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "subscription_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_events" (
    "id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "actor_type" TEXT NOT NULL,
    "actor_user_id" UUID,
    "payload" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "location_code" TEXT NOT NULL DEFAULT 'MAIN',
    "quantity_on_hand" INTEGER NOT NULL DEFAULT 0,
    "quantity_reserved" INTEGER NOT NULL DEFAULT 0,
    "low_stock_threshold" INTEGER NOT NULL DEFAULT 0,
    "track_inventory" BOOLEAN NOT NULL DEFAULT true,
    "allow_backorder" BOOLEAN NOT NULL DEFAULT false,
    "last_counted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "inventory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_movements" (
    "id" UUID NOT NULL,
    "inventory_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "reason" "inventory_reason" NOT NULL,
    "quantity_delta" INTEGER NOT NULL,
    "quantity_after" INTEGER NOT NULL,
    "reserved_delta" INTEGER NOT NULL DEFAULT 0,
    "reference_type" TEXT,
    "reference_id" UUID,
    "note" TEXT,
    "actor_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "method" "payment_method" NOT NULL,
    "status" "payment_status" NOT NULL DEFAULT 'DUE',
    "amount_paise" BIGINT NOT NULL,
    "amount_paid_paise" BIGINT NOT NULL DEFAULT 0,
    "amount_refunded_paise" BIGINT NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "provider" TEXT,
    "provider_payment_id" TEXT,
    "paid_at" TIMESTAMPTZ(6),
    "collected_by_user_id" UUID,
    "failure_reason" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_attempts" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_order_id" TEXT,
    "provider_payment_id" TEXT,
    "status" TEXT NOT NULL,
    "amount_paise" BIGINT NOT NULL,
    "error_code" TEXT,
    "error_message" TEXT,
    "raw_response" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payment_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "amount_paise" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "refund_status" NOT NULL DEFAULT 'PENDING',
    "provider_refund_id" TEXT,
    "initiated_by_user_id" UUID,
    "processed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_webhook_events" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "signature_verified" BOOLEAN NOT NULL DEFAULT false,
    "processed_at" TIMESTAMPTZ(6),
    "processing_error" TEXT,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_outbox" (
    "id" UUID NOT NULL,
    "business_id" UUID,
    "event_type" TEXT NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "dedupe_key" TEXT,
    "status" "outbox_status" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" TEXT,
    "available_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "action_url" TEXT,
    "image_url" TEXT,
    "data" JSONB,
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_logs" (
    "id" UUID NOT NULL,
    "outbox_id" UUID,
    "user_id" UUID,
    "channel" "notification_channel" NOT NULL,
    "recipient" TEXT,
    "template_key" TEXT,
    "provider" TEXT,
    "provider_message_id" TEXT,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "sent_at" TIMESTAMPTZ(6),
    "delivered_at" TIMESTAMPTZ(6),
    "opened_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "channel" "notification_channel" NOT NULL,
    "category" TEXT NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "favorites" (
    "id" UUID NOT NULL,
    "customer_profile_id" UUID NOT NULL,
    "product_id" UUID,
    "combo_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favorites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" UUID NOT NULL,
    "customer_profile_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "rating" SMALLINT NOT NULL,
    "title" TEXT,
    "body" TEXT,
    "status" "review_status" NOT NULL DEFAULT 'PENDING',
    "moderated_by" UUID,
    "moderated_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupons" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "code" CITEXT NOT NULL,
    "description" TEXT,
    "discount_type" "discount_type" NOT NULL,
    "discount_value" INTEGER NOT NULL,
    "max_discount_paise" BIGINT,
    "min_order_value_paise" BIGINT NOT NULL DEFAULT 0,
    "applies_to" TEXT NOT NULL DEFAULT 'ALL',
    "applies_to_ids" UUID[],
    "first_order_only" BOOLEAN NOT NULL DEFAULT false,
    "usage_limit_total" INTEGER,
    "usage_limit_per_customer" INTEGER,
    "used_count" INTEGER NOT NULL DEFAULT 0,
    "valid_from" TIMESTAMPTZ(6),
    "valid_until" TIMESTAMPTZ(6),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupon_redemptions" (
    "id" UUID NOT NULL,
    "coupon_id" UUID NOT NULL,
    "customer_profile_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "discount_applied_paise" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coupon_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_logs_resource_type_resource_id_created_at_idx" ON "audit_logs"("resource_type", "resource_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_actor_user_id_created_at_idx" ON "audit_logs"("actor_user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at" DESC);

-- CreateIndex
CREATE INDEX "users_user_type_status_idx" ON "users"("user_type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "users_firebase_uid_user_type_key" ON "users"("firebase_uid", "user_type");

-- CreateIndex
CREATE UNIQUE INDEX "customer_profiles_user_id_key" ON "customer_profiles"("user_id");

-- CreateIndex
CREATE INDEX "customer_profiles_business_id_idx" ON "customer_profiles"("business_id");

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_user_id_key" ON "admin_users"("user_id");

-- CreateIndex
CREATE INDEX "admin_users_business_id_idx" ON "admin_users"("business_id");

-- CreateIndex
CREATE UNIQUE INDEX "roles_business_id_key_key" ON "roles"("business_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_key_key" ON "permissions"("key");

-- CreateIndex
CREATE INDEX "permissions_resource_idx" ON "permissions"("resource");

-- CreateIndex
CREATE INDEX "addresses_customer_profile_id_idx" ON "addresses"("customer_profile_id");

-- CreateIndex
CREATE INDEX "addresses_pincode_idx" ON "addresses"("pincode");

-- CreateIndex
CREATE INDEX "addresses_delivery_zone_id_idx" ON "addresses"("delivery_zone_id");

-- CreateIndex
CREATE INDEX "categories_parent_id_display_order_idx" ON "categories"("parent_id", "display_order");

-- CreateIndex
CREATE INDEX "categories_business_id_is_active_idx" ON "categories"("business_id", "is_active");

-- CreateIndex
CREATE INDEX "products_category_id_status_idx" ON "products"("category_id", "status");

-- CreateIndex
CREATE INDEX "products_business_id_status_idx" ON "products"("business_id", "status");

-- CreateIndex
CREATE INDEX "products_popularity_score_idx" ON "products"("popularity_score" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "products_id_business_id_key" ON "products"("id", "business_id");

-- CreateIndex
CREATE INDEX "product_variants_product_id_display_order_idx" ON "product_variants"("product_id", "display_order");

-- CreateIndex
CREATE INDEX "product_variants_availability_idx" ON "product_variants"("availability");

-- CreateIndex
CREATE INDEX "product_variants_business_id_idx" ON "product_variants"("business_id");

-- CreateIndex
CREATE INDEX "product_images_product_id_display_order_idx" ON "product_images"("product_id", "display_order");

-- CreateIndex
CREATE UNIQUE INDEX "tags_business_id_key_key" ON "tags"("business_id", "key");

-- CreateIndex
CREATE INDEX "combos_business_id_status_idx" ON "combos"("business_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "combo_items_combo_id_variant_id_key" ON "combo_items"("combo_id", "variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_zone_availability_variant_id_delivery_zone_id_key" ON "product_zone_availability"("variant_id", "delivery_zone_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_zone_availability_combo_id_delivery_zone_id_key" ON "product_zone_availability"("combo_id", "delivery_zone_id");

-- CreateIndex
CREATE INDEX "delivery_zones_city_id_is_active_idx" ON "delivery_zones"("city_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_zones_business_id_code_key" ON "delivery_zones"("business_id", "code");

-- CreateIndex
CREATE INDEX "delivery_slots_business_id_is_active_idx" ON "delivery_slots"("business_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_slots_business_id_code_key" ON "delivery_slots"("business_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "slot_zone_assignments_delivery_slot_id_delivery_zone_id_key" ON "slot_zone_assignments"("delivery_slot_id", "delivery_zone_id");

-- CreateIndex
CREATE INDEX "slot_capacity_service_date_delivery_zone_id_idx" ON "slot_capacity"("service_date", "delivery_zone_id");

-- CreateIndex
CREATE UNIQUE INDEX "slot_capacity_delivery_slot_id_delivery_zone_id_service_dat_key" ON "slot_capacity"("delivery_slot_id", "delivery_zone_id", "service_date");

-- CreateIndex
CREATE INDEX "business_holidays_business_id_holiday_date_idx" ON "business_holidays"("business_id", "holiday_date");

-- CreateIndex
CREATE INDEX "carts_last_activity_at_idx" ON "carts"("last_activity_at");

-- CreateIndex
CREATE UNIQUE INDEX "carts_customer_profile_id_key" ON "carts"("customer_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "cart_items_cart_id_variant_id_key" ON "cart_items"("cart_id", "variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "cart_items_cart_id_combo_id_key" ON "cart_items"("cart_id", "combo_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_order_number_key" ON "orders"("order_number");

-- CreateIndex
CREATE INDEX "orders_customer_profile_id_placed_at_idx" ON "orders"("customer_profile_id", "placed_at" DESC);

-- CreateIndex
CREATE INDEX "orders_status_service_date_idx" ON "orders"("status", "service_date");

-- CreateIndex
CREATE INDEX "orders_service_date_delivery_slot_id_status_idx" ON "orders"("service_date", "delivery_slot_id", "status");

-- CreateIndex
CREATE INDEX "orders_subscription_id_idx" ON "orders"("subscription_id");

-- CreateIndex
CREATE INDEX "orders_business_id_placed_at_idx" ON "orders"("business_id", "placed_at" DESC);

-- CreateIndex
CREATE INDEX "order_items_order_id_idx" ON "order_items"("order_id");

-- CreateIndex
CREATE INDEX "order_status_history_order_id_created_at_idx" ON "order_status_history"("order_id", "created_at");

-- CreateIndex
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_user_id_endpoint_key_key" ON "idempotency_keys"("user_id", "endpoint", "key");

-- CreateIndex
CREATE INDEX "subscription_plans_business_id_status_idx" ON "subscription_plans"("business_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_plan_items_plan_id_variant_id_key" ON "subscription_plan_items"("plan_id", "variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_plan_items_plan_id_combo_id_key" ON "subscription_plan_items"("plan_id", "combo_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_subscription_number_key" ON "subscriptions"("subscription_number");

-- CreateIndex
CREATE INDEX "subscriptions_customer_profile_id_status_idx" ON "subscriptions"("customer_profile_id", "status");

-- CreateIndex
CREATE INDEX "subscriptions_status_next_delivery_date_idx" ON "subscriptions"("status", "next_delivery_date");

-- CreateIndex
CREATE INDEX "subscriptions_delivery_slot_id_status_idx" ON "subscriptions"("delivery_slot_id", "status");

-- CreateIndex
CREATE INDEX "subscriptions_business_id_status_idx" ON "subscriptions"("business_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_items_subscription_id_variant_id_key" ON "subscription_items"("subscription_id", "variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_items_subscription_id_combo_id_key" ON "subscription_items"("subscription_id", "combo_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_deliveries_order_id_key" ON "subscription_deliveries"("order_id");

-- CreateIndex
CREATE INDEX "subscription_deliveries_delivery_date_status_idx" ON "subscription_deliveries"("delivery_date", "status");

-- CreateIndex
CREATE INDEX "subscription_deliveries_subscription_id_delivery_date_idx" ON "subscription_deliveries"("subscription_id", "delivery_date" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "subscription_deliveries_subscription_id_delivery_date_key" ON "subscription_deliveries"("subscription_id", "delivery_date");

-- CreateIndex
CREATE INDEX "subscription_events_subscription_id_created_at_idx" ON "subscription_events"("subscription_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "inventory_business_id_idx" ON "inventory"("business_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_variant_id_location_code_key" ON "inventory"("variant_id", "location_code");

-- CreateIndex
CREATE INDEX "inventory_movements_variant_id_created_at_idx" ON "inventory_movements"("variant_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "inventory_movements_reference_type_reference_id_idx" ON "inventory_movements"("reference_type", "reference_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_order_id_key" ON "payments"("order_id");

-- CreateIndex
CREATE INDEX "payments_status_idx" ON "payments"("status");

-- CreateIndex
CREATE INDEX "payment_attempts_payment_id_created_at_idx" ON "payment_attempts"("payment_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "refunds_order_id_idx" ON "refunds"("order_id");

-- CreateIndex
CREATE INDEX "payment_webhook_events_processed_at_idx" ON "payment_webhook_events"("processed_at");

-- CreateIndex
CREATE UNIQUE INDEX "payment_webhook_events_provider_event_id_key" ON "payment_webhook_events"("provider", "event_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_outbox_dedupe_key_key" ON "notification_outbox"("dedupe_key");

-- CreateIndex
CREATE INDEX "notification_outbox_status_next_attempt_at_idx" ON "notification_outbox"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "notification_outbox_aggregate_type_aggregate_id_idx" ON "notification_outbox"("aggregate_type", "aggregate_id");

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "notification_logs_user_id_created_at_idx" ON "notification_logs"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "notification_logs_outbox_id_idx" ON "notification_logs"("outbox_id");

-- CreateIndex
CREATE INDEX "notification_logs_provider_message_id_idx" ON "notification_logs"("provider_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_user_id_channel_category_key" ON "notification_preferences"("user_id", "channel", "category");

-- CreateIndex
CREATE UNIQUE INDEX "favorites_customer_profile_id_product_id_key" ON "favorites"("customer_profile_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "favorites_customer_profile_id_combo_id_key" ON "favorites"("customer_profile_id", "combo_id");

-- CreateIndex
CREATE INDEX "reviews_product_id_status_idx" ON "reviews"("product_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_customer_profile_id_product_id_order_id_key" ON "reviews"("customer_profile_id", "product_id", "order_id");

-- CreateIndex
CREATE INDEX "coupons_business_id_is_active_idx" ON "coupons"("business_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "coupons_business_id_code_key" ON "coupons"("business_id", "code");

-- CreateIndex
CREATE INDEX "coupon_redemptions_customer_profile_id_idx" ON "coupon_redemptions"("customer_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "coupon_redemptions_coupon_id_order_id_key" ON "coupon_redemptions"("coupon_id", "order_id");

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_preferred_slot_id_fkey" FOREIGN KEY ("preferred_slot_id") REFERENCES "delivery_slots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_user_roles" ADD CONSTRAINT "admin_user_roles_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_user_roles" ADD CONSTRAINT "admin_user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_customer_profile_id_fkey" FOREIGN KEY ("customer_profile_id") REFERENCES "customer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_delivery_zone_id_fkey" FOREIGN KEY ("delivery_zone_id") REFERENCES "delivery_zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_business_id_fkey" FOREIGN KEY ("product_id", "business_id") REFERENCES "products"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tags" ADD CONSTRAINT "tags_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_tags" ADD CONSTRAINT "product_tags_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_tags" ADD CONSTRAINT "product_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "combos" ADD CONSTRAINT "combos_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "combo_items" ADD CONSTRAINT "combo_items_combo_id_fkey" FOREIGN KEY ("combo_id") REFERENCES "combos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "combo_items" ADD CONSTRAINT "combo_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_zone_availability" ADD CONSTRAINT "product_zone_availability_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_zone_availability" ADD CONSTRAINT "product_zone_availability_combo_id_fkey" FOREIGN KEY ("combo_id") REFERENCES "combos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_zone_availability" ADD CONSTRAINT "product_zone_availability_delivery_zone_id_fkey" FOREIGN KEY ("delivery_zone_id") REFERENCES "delivery_zones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_pincodes" ADD CONSTRAINT "service_pincodes_delivery_zone_id_fkey" FOREIGN KEY ("delivery_zone_id") REFERENCES "delivery_zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_zones" ADD CONSTRAINT "delivery_zones_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_zones" ADD CONSTRAINT "delivery_zones_city_id_fkey" FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_slots" ADD CONSTRAINT "delivery_slots_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slot_zone_assignments" ADD CONSTRAINT "slot_zone_assignments_delivery_slot_id_fkey" FOREIGN KEY ("delivery_slot_id") REFERENCES "delivery_slots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slot_zone_assignments" ADD CONSTRAINT "slot_zone_assignments_delivery_zone_id_fkey" FOREIGN KEY ("delivery_zone_id") REFERENCES "delivery_zones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slot_capacity" ADD CONSTRAINT "slot_capacity_delivery_slot_id_fkey" FOREIGN KEY ("delivery_slot_id") REFERENCES "delivery_slots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slot_capacity" ADD CONSTRAINT "slot_capacity_delivery_zone_id_fkey" FOREIGN KEY ("delivery_zone_id") REFERENCES "delivery_zones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_holidays" ADD CONSTRAINT "business_holidays_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_holidays" ADD CONSTRAINT "business_holidays_delivery_zone_id_fkey" FOREIGN KEY ("delivery_zone_id") REFERENCES "delivery_zones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_holidays" ADD CONSTRAINT "business_holidays_delivery_slot_id_fkey" FOREIGN KEY ("delivery_slot_id") REFERENCES "delivery_slots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carts" ADD CONSTRAINT "carts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carts" ADD CONSTRAINT "carts_customer_profile_id_fkey" FOREIGN KEY ("customer_profile_id") REFERENCES "customer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carts" ADD CONSTRAINT "carts_delivery_address_id_fkey" FOREIGN KEY ("delivery_address_id") REFERENCES "addresses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cart_id_fkey" FOREIGN KEY ("cart_id") REFERENCES "carts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_combo_id_fkey" FOREIGN KEY ("combo_id") REFERENCES "combos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_profile_id_fkey" FOREIGN KEY ("customer_profile_id") REFERENCES "customer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_delivery_zone_id_fkey" FOREIGN KEY ("delivery_zone_id") REFERENCES "delivery_zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_delivery_slot_id_fkey" FOREIGN KEY ("delivery_slot_id") REFERENCES "delivery_slots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_address_id_fkey" FOREIGN KEY ("address_id") REFERENCES "addresses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_subscription_delivery_id_fkey" FOREIGN KEY ("subscription_delivery_id") REFERENCES "subscription_deliveries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_combo_id_fkey" FOREIGN KEY ("combo_id") REFERENCES "combos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_parent_item_id_fkey" FOREIGN KEY ("parent_item_id") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_plans" ADD CONSTRAINT "subscription_plans_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_plan_items" ADD CONSTRAINT "subscription_plan_items_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "subscription_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_plan_items" ADD CONSTRAINT "subscription_plan_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_plan_items" ADD CONSTRAINT "subscription_plan_items_combo_id_fkey" FOREIGN KEY ("combo_id") REFERENCES "combos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_customer_profile_id_fkey" FOREIGN KEY ("customer_profile_id") REFERENCES "customer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_subscription_plan_id_fkey" FOREIGN KEY ("subscription_plan_id") REFERENCES "subscription_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_delivery_slot_id_fkey" FOREIGN KEY ("delivery_slot_id") REFERENCES "delivery_slots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_address_id_fkey" FOREIGN KEY ("address_id") REFERENCES "addresses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_delivery_zone_id_fkey" FOREIGN KEY ("delivery_zone_id") REFERENCES "delivery_zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_items" ADD CONSTRAINT "subscription_items_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_items" ADD CONSTRAINT "subscription_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_items" ADD CONSTRAINT "subscription_items_combo_id_fkey" FOREIGN KEY ("combo_id") REFERENCES "combos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_deliveries" ADD CONSTRAINT "subscription_deliveries_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_deliveries" ADD CONSTRAINT "subscription_deliveries_delivery_slot_id_fkey" FOREIGN KEY ("delivery_slot_id") REFERENCES "delivery_slots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_deliveries" ADD CONSTRAINT "subscription_deliveries_address_id_fkey" FOREIGN KEY ("address_id") REFERENCES "addresses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_deliveries" ADD CONSTRAINT "subscription_deliveries_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_inventory_id_fkey" FOREIGN KEY ("inventory_id") REFERENCES "inventory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_outbox_id_fkey" FOREIGN KEY ("outbox_id") REFERENCES "notification_outbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_customer_profile_id_fkey" FOREIGN KEY ("customer_profile_id") REFERENCES "customer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_combo_id_fkey" FOREIGN KEY ("combo_id") REFERENCES "combos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_customer_profile_id_fkey" FOREIGN KEY ("customer_profile_id") REFERENCES "customer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_customer_profile_id_fkey" FOREIGN KEY ("customer_profile_id") REFERENCES "customer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ══════════════════════════════════════════════════════════════════════════
-- HAND-WRITTEN CONSTRAINT LAYER (PHASE 02)
--
-- Everything below is what Prisma cannot express: CHECK constraints, partial
-- unique indexes, generated columns, expression indexes and triggers.
--
-- These are not decoration. They are the mechanism that makes the five
-- cross-cutting invariants in docs/31 impossible to violate, rather than
-- merely unlikely — they hold under concurrency, retries, multiple workers
-- and code paths nobody has written yet (ADR-020).
-- ══════════════════════════════════════════════════════════════════════════

-- ── Addresses ────────────────────────────────────────────────────────────
ALTER TABLE "addresses"
    ADD CONSTRAINT "addresses_pincode_format" CHECK ("pincode" ~ '^[1-9][0-9]{5}$'),
    ADD CONSTRAINT "addresses_country_iso3166" CHECK ("country" ~ '^[A-Z]{2}$'),
    ADD CONSTRAINT "addresses_recipient_name_not_blank" CHECK (length(btrim("recipient_name")) > 0);

-- Exactly one default address per customer (docs/04 §4.5).
CREATE UNIQUE INDEX "addresses_one_default_per_customer"
    ON "addresses" ("customer_profile_id")
    WHERE "is_default" AND "deleted_at" IS NULL;

CREATE INDEX "addresses_customer_active_idx"
    ON "addresses" ("customer_profile_id") WHERE "deleted_at" IS NULL;

-- ── Users ────────────────────────────────────────────────────────────────
-- A customer's phone is their identity and delivery contact; it must be
-- unique among customers but may repeat for admins (docs/04 §4.1).
CREATE UNIQUE INDEX "users_customer_phone_unique"
    ON "users" ("phone")
    WHERE "user_type" = 'CUSTOMER' AND "phone" IS NOT NULL;

ALTER TABLE "users"
    ADD CONSTRAINT "users_phone_e164"
        CHECK ("phone" IS NULL OR "phone" ~ '^\+[1-9][0-9]{7,14}$');

-- ── Categories ───────────────────────────────────────────────────────────
ALTER TABLE "categories"
    ADD CONSTRAINT "categories_no_self_parent" CHECK ("parent_id" <> "id"),
    ADD CONSTRAINT "categories_name_not_blank" CHECK (length(btrim("name")) > 0);

CREATE UNIQUE INDEX "categories_business_slug_unique"
    ON "categories" ("business_id", "slug") WHERE "deleted_at" IS NULL;

-- ── Products ─────────────────────────────────────────────────────────────
ALTER TABLE "products"
    ADD CONSTRAINT "products_name_not_blank" CHECK (length(btrim("name")) > 0),
    ADD CONSTRAINT "products_shelf_life_positive"
        CHECK ("shelf_life_hours" IS NULL OR "shelf_life_hours" > 0),
    ADD CONSTRAINT "products_popularity_non_negative" CHECK ("popularity_score" >= 0);

CREATE UNIQUE INDEX "products_business_slug_unique"
    ON "products" ("business_id", "slug") WHERE "deleted_at" IS NULL;

-- search_vector must be a GENERATED column so it can never drift from the
-- row it describes. Prisma emits a plain tsvector column, so it is dropped
-- and re-added here (docs/04 §5.2.2).
--
-- 'simple' rather than 'english': the catalogue mixes English and
-- transliterated Hindi ("chaat", "moong"), where stemming harms more than
-- it helps. Fuzzy matching is handled separately by pg_trgm on name.
-- array_to_string() is only STABLE (it may invoke element output functions),
-- so PostgreSQL refuses it inside a GENERATED column. This wrapper is
-- genuinely immutable for text[] -- a text array's output function cannot
-- vary -- which lets the documented search weighting survive intact rather
-- than dropping dietary tags from the index.
CREATE OR REPLACE FUNCTION "immutable_array_to_string"(text[], text)
RETURNS text AS $$
    SELECT array_to_string($1, $2);
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;

ALTER TABLE "products" DROP COLUMN "search_vector";
ALTER TABLE "products" ADD COLUMN "search_vector" tsvector
    GENERATED ALWAYS AS (
        setweight(to_tsvector('simple'::regconfig, coalesce("name", '')), 'A') ||
        setweight(to_tsvector('simple'::regconfig, coalesce("short_description", '')), 'B') ||
        setweight(to_tsvector('simple'::regconfig, "immutable_array_to_string"(coalesce("dietary_tags", '{}'), ' ')), 'C') ||
        setweight(to_tsvector('simple'::regconfig, coalesce("description", '')), 'D')
    ) STORED;

CREATE INDEX "products_search_vector_idx" ON "products" USING GIN ("search_vector");
CREATE INDEX "products_dietary_tags_idx"  ON "products" USING GIN ("dietary_tags");
CREATE INDEX "products_allergens_idx"     ON "products" USING GIN ("allergens");
CREATE INDEX "products_name_trgm_idx"     ON "products" USING GIN ("name" gin_trgm_ops);

CREATE INDEX "products_featured_active_idx"
    ON "products" ("business_id") WHERE "is_featured" AND "status" = 'ACTIVE';
CREATE INDEX "products_bestseller_active_idx"
    ON "products" ("business_id") WHERE "is_bestseller" AND "status" = 'ACTIVE';
CREATE INDEX "products_active_idx"
    ON "products" ("business_id", "status") WHERE "deleted_at" IS NULL;

-- ── Product variants ─────────────────────────────────────────────────────
ALTER TABLE "product_variants"
    ADD CONSTRAINT "product_variants_price_non_negative" CHECK ("price_paise" >= 0),
    ADD CONSTRAINT "product_variants_cost_non_negative"
        CHECK ("cost_paise" IS NULL OR "cost_paise" >= 0),
    -- A discount can never be negative.
    ADD CONSTRAINT "product_variants_mrp_gte_price"
        CHECK ("mrp_paise" IS NULL OR "mrp_paise" >= "price_paise"),
    -- A subscription must never cost more than buying one-off.
    ADD CONSTRAINT "product_variants_sub_price_lte_price"
        CHECK ("subscription_price_paise" IS NULL OR "subscription_price_paise" <= "price_paise"),
    ADD CONSTRAINT "product_variants_tax_rate_range"
        CHECK ("tax_rate_bps" >= 0 AND "tax_rate_bps" <= 10000),
    ADD CONSTRAINT "product_variants_unit_value_positive" CHECK ("unit_value" > 0),
    ADD CONSTRAINT "product_variants_max_qty_positive"
        CHECK ("max_order_quantity" IS NULL OR "max_order_quantity" > 0);

CREATE UNIQUE INDEX "product_variants_business_sku_unique"
    ON "product_variants" ("business_id", "sku") WHERE "deleted_at" IS NULL;

-- Exactly one default variant per product (docs/04 §5.3).
CREATE UNIQUE INDEX "product_variants_one_default_per_product"
    ON "product_variants" ("product_id") WHERE "is_default" AND "deleted_at" IS NULL;

-- ── Product images ───────────────────────────────────────────────────────
-- Exactly one primary image per product.
CREATE UNIQUE INDEX "product_images_one_primary_per_product"
    ON "product_images" ("product_id") WHERE "display_order" = 0;

ALTER TABLE "product_images"
    ADD CONSTRAINT "product_images_display_order_non_negative" CHECK ("display_order" >= 0);

-- ── Combos ───────────────────────────────────────────────────────────────
ALTER TABLE "combos"
    ADD CONSTRAINT "combos_pricing_mode_valid"
        CHECK ("pricing_mode" IN ('FIXED', 'DISCOUNT')),
    -- Each pricing mode requires its own fields. Without this a combo could
    -- exist with no way to compute what it costs.
    ADD CONSTRAINT "combos_pricing_fields_complete" CHECK (
        ("pricing_mode" = 'FIXED'    AND "price_paise" IS NOT NULL) OR
        ("pricing_mode" = 'DISCOUNT' AND "discount_type" IS NOT NULL AND "discount_value" IS NOT NULL)
    ),
    ADD CONSTRAINT "combos_price_non_negative"
        CHECK ("price_paise" IS NULL OR "price_paise" >= 0),
    ADD CONSTRAINT "combos_availability_window"
        CHECK ("available_until" IS NULL OR "available_from" IS NULL OR "available_until" >= "available_from");

CREATE UNIQUE INDEX "combos_business_slug_unique"
    ON "combos" ("business_id", "slug") WHERE "deleted_at" IS NULL;

ALTER TABLE "combo_items"
    ADD CONSTRAINT "combo_items_quantity_positive" CHECK ("quantity" > 0);

-- ── Product zone availability ────────────────────────────────────────────
-- Exactly one of variant / combo (docs/04 §5.8).
ALTER TABLE "product_zone_availability"
    ADD CONSTRAINT "product_zone_availability_exactly_one_target" CHECK (
        ("variant_id" IS NOT NULL AND "combo_id" IS NULL) OR
        ("variant_id" IS NULL AND "combo_id" IS NOT NULL)
    );

-- ── Delivery zones ───────────────────────────────────────────────────────
ALTER TABLE "delivery_zones"
    ADD CONSTRAINT "delivery_zones_fee_non_negative" CHECK ("delivery_fee_paise" >= 0),
    ADD CONSTRAINT "delivery_zones_min_order_non_negative" CHECK ("min_order_value_paise" >= 0),
    ADD CONSTRAINT "delivery_zones_free_above_non_negative"
        CHECK ("free_delivery_above_paise" IS NULL OR "free_delivery_above_paise" >= 0),
    ADD CONSTRAINT "delivery_zones_max_daily_positive"
        CHECK ("max_daily_orders" IS NULL OR "max_daily_orders" > 0);

-- ── Delivery slots ───────────────────────────────────────────────────────
-- No slot time is hard-coded anywhere in the codebase; these constraints
-- describe the SHAPE of a valid slot, never its values (BR-SV7).
ALTER TABLE "delivery_slots"
    -- Overnight windows are explicitly unsupported at MVP (docs/04 §6.5).
    ADD CONSTRAINT "delivery_slots_end_after_start" CHECK ("end_time" > "start_time"),
    ADD CONSTRAINT "delivery_slots_cutoff_days_non_negative" CHECK ("cutoff_days_before" >= 0),
    ADD CONSTRAINT "delivery_slots_capacity_positive" CHECK ("default_capacity" > 0),
    ADD CONSTRAINT "delivery_slots_fee_non_negative"
        CHECK ("delivery_fee_paise" IS NULL OR "delivery_fee_paise" >= 0),
    -- ISO weekdays only, and at least one day.
    ADD CONSTRAINT "delivery_slots_available_days_valid" CHECK (
        array_length("available_days", 1) BETWEEN 1 AND 7
        AND "available_days" <@ ARRAY[1,2,3,4,5,6,7]::smallint[]
    );

-- ── Slot capacity ────────────────────────────────────────────────────────
-- THE over-booking backstop. A buggy new code path becomes a failed
-- transaction rather than an undeliverable order (BR-D6, invariant 1).
ALTER TABLE "slot_capacity"
    ADD CONSTRAINT "slot_capacity_booked_within_capacity"
        CHECK ("booked_count" >= 0 AND "booked_count" <= "capacity"),
    ADD CONSTRAINT "slot_capacity_capacity_non_negative" CHECK ("capacity" >= 0),
    ADD CONSTRAINT "slot_capacity_reserved_within_capacity"
        CHECK ("reserved_for_subscriptions" >= 0 AND "reserved_for_subscriptions" <= "capacity");

-- ── Business holidays ────────────────────────────────────────────────────
-- NULLS NOT DISTINCT (PostgreSQL 15+) so that a business-wide holiday
-- (both scope columns NULL) cannot be inserted twice. Default NULL handling
-- would treat every such row as distinct and allow duplicates.
CREATE UNIQUE INDEX "business_holidays_scope_unique"
    ON "business_holidays" ("business_id", "holiday_date", "delivery_zone_id", "delivery_slot_id")
    NULLS NOT DISTINCT;

-- ── Cart items ───────────────────────────────────────────────────────────
ALTER TABLE "cart_items"
    ADD CONSTRAINT "cart_items_quantity_positive" CHECK ("quantity" > 0),
    ADD CONSTRAINT "cart_items_exactly_one_target" CHECK (
        ("variant_id" IS NOT NULL AND "combo_id" IS NULL) OR
        ("variant_id" IS NULL AND "combo_id" IS NOT NULL)
    );

-- ── Orders ───────────────────────────────────────────────────────────────
ALTER TABLE "orders"
    -- The invoice always adds up (invariant 5).
    ADD CONSTRAINT "orders_total_is_sum_of_parts" CHECK (
        "total_paise" = "subtotal_paise" - "discount_paise" + "delivery_fee_paise" + "tax_paise"
    ),
    ADD CONSTRAINT "orders_total_non_negative" CHECK ("total_paise" >= 0),
    ADD CONSTRAINT "orders_subtotal_non_negative" CHECK ("subtotal_paise" >= 0),
    ADD CONSTRAINT "orders_discount_non_negative" CHECK ("discount_paise" >= 0),
    ADD CONSTRAINT "orders_delivery_fee_non_negative" CHECK ("delivery_fee_paise" >= 0),
    ADD CONSTRAINT "orders_tax_non_negative" CHECK ("tax_paise" >= 0),
    -- A subscription order must name its subscription, and a one-time order
    -- must not (docs/04 §7.3).
    ADD CONSTRAINT "orders_source_matches_subscription" CHECK (
        ("source" = 'SUBSCRIPTION') = ("subscription_id" IS NOT NULL)
    ),
    ADD CONSTRAINT "orders_cancelled_fields_consistent" CHECK (
        ("status" <> 'CANCELLED') OR ("cancelled_at" IS NOT NULL)
    );

-- ONE order per subscription delivery. With the UNIQUE on
-- subscription_deliveries (subscription_id, delivery_date), this is what
-- makes duplicate subscription orders structurally impossible — it holds
-- under concurrent schedulers with no distributed lock (BR-S9, invariant 4).
CREATE UNIQUE INDEX "orders_one_per_subscription_delivery"
    ON "orders" ("subscription_delivery_id")
    WHERE "subscription_delivery_id" IS NOT NULL;

CREATE INDEX "orders_payment_due_idx"
    ON "orders" ("business_id", "service_date") WHERE "payment_status" = 'DUE';

-- Human-facing order numbers come from a SEQUENCE, never count(*)+1, which
-- races and reuses numbers after a cancellation (docs/04 §7.3).
CREATE SEQUENCE IF NOT EXISTS "order_number_seq" START 1;
CREATE SEQUENCE IF NOT EXISTS "subscription_number_seq" START 1;

-- ── Order items ──────────────────────────────────────────────────────────
ALTER TABLE "order_items"
    ADD CONSTRAINT "order_items_quantity_positive" CHECK ("quantity" > 0),
    ADD CONSTRAINT "order_items_exactly_one_target" CHECK (
        ("variant_id" IS NOT NULL AND "combo_id" IS NULL) OR
        ("variant_id" IS NULL AND "combo_id" IS NOT NULL)
    ),
    ADD CONSTRAINT "order_items_unit_price_non_negative" CHECK ("unit_price_paise" >= 0),
    ADD CONSTRAINT "order_items_line_total_non_negative" CHECK ("line_total_paise" >= 0),
    -- A combo component carries no money and must hang off a parent; a
    -- priced line must not (docs/12 §2).
    ADD CONSTRAINT "order_items_component_has_parent" CHECK (
        ("is_component" = false AND "parent_item_id" IS NULL) OR
        ("is_component" = true  AND "parent_item_id" IS NOT NULL)
    );

-- ── Idempotency keys ─────────────────────────────────────────────────────
ALTER TABLE "idempotency_keys"
    ADD CONSTRAINT "idempotency_keys_key_not_blank" CHECK (length(btrim("key")) > 0);

-- ── Subscription plans ───────────────────────────────────────────────────
ALTER TABLE "subscription_plans"
    ADD CONSTRAINT "subscription_plans_duration_order" CHECK (
        "min_duration_days" IS NULL OR "max_duration_days" IS NULL
        OR "max_duration_days" >= "min_duration_days"
    ),
    ADD CONSTRAINT "subscription_plans_notice_non_negative" CHECK (
        "pause_notice_hours" >= 0 AND "cancellation_notice_hours" >= 0
    ),
    ADD CONSTRAINT "subscription_plans_allowed_days_valid" CHECK (
        "allowed_days" <@ ARRAY[1,2,3,4,5,6,7]::smallint[]
    );

CREATE UNIQUE INDEX "subscription_plans_business_slug_unique"
    ON "subscription_plans" ("business_id", "slug") WHERE "deleted_at" IS NULL;

ALTER TABLE "subscription_plan_items"
    ADD CONSTRAINT "subscription_plan_items_quantity_positive" CHECK ("quantity" > 0),
    ADD CONSTRAINT "subscription_plan_items_exactly_one_target" CHECK (
        ("variant_id" IS NOT NULL AND "combo_id" IS NULL) OR
        ("variant_id" IS NULL AND "combo_id" IS NOT NULL)
    );

-- ── Subscriptions ────────────────────────────────────────────────────────
ALTER TABLE "subscriptions"
    ADD CONSTRAINT "subscriptions_end_after_start"
        CHECK ("end_date" IS NULL OR "end_date" >= "start_date"),
    ADD CONSTRAINT "subscriptions_delivery_days_valid" CHECK (
        array_length("delivery_days", 1) BETWEEN 1 AND 7
        AND "delivery_days" <@ ARRAY[1,2,3,4,5,6,7]::smallint[]
    ),
    ADD CONSTRAINT "subscriptions_price_non_negative"
        CHECK ("price_per_delivery_paise" >= 0),
    ADD CONSTRAINT "subscriptions_counts_non_negative" CHECK (
        "total_deliveries_count" >= 0 AND "total_skipped_count" >= 0
    ),
    ADD CONSTRAINT "subscriptions_interval_positive"
        CHECK ("interval_days" IS NULL OR "interval_days" > 0),
    ADD CONSTRAINT "subscriptions_cancelled_fields_consistent" CHECK (
        ("status" <> 'CANCELLED') OR ("cancelled_at" IS NOT NULL)
    );

ALTER TABLE "subscription_items"
    ADD CONSTRAINT "subscription_items_quantity_positive" CHECK ("quantity" > 0),
    ADD CONSTRAINT "subscription_items_price_non_negative" CHECK ("unit_price_paise" >= 0),
    ADD CONSTRAINT "subscription_items_exactly_one_target" CHECK (
        ("variant_id" IS NOT NULL AND "combo_id" IS NULL) OR
        ("variant_id" IS NULL AND "combo_id" IS NOT NULL)
    );

ALTER TABLE "subscription_deliveries"
    ADD CONSTRAINT "subscription_deliveries_expected_total_non_negative"
        CHECK ("expected_total_paise" >= 0),
    -- A delivery that produced an order must say when (docs/11 §4.2).
    ADD CONSTRAINT "subscription_deliveries_materialised_consistent" CHECK (
        ("order_id" IS NULL) OR ("materialised_at" IS NOT NULL)
    ),
    ADD CONSTRAINT "subscription_deliveries_skipped_consistent" CHECK (
        ("status" <> 'SKIPPED') OR ("skipped_at" IS NOT NULL)
    );

CREATE INDEX "subscription_deliveries_scheduled_idx"
    ON "subscription_deliveries" ("delivery_date") WHERE "status" = 'SCHEDULED';

-- ── Inventory ────────────────────────────────────────────────────────────
-- quantity_available is on_hand - reserved and is NEVER stored; a third
-- number could disagree with the other two, and the bug would surface as
-- overselling (BR-I6, invariant 2).
ALTER TABLE "inventory"
    ADD CONSTRAINT "inventory_on_hand_non_negative" CHECK ("quantity_on_hand" >= 0),
    ADD CONSTRAINT "inventory_reserved_non_negative" CHECK ("quantity_reserved" >= 0),
    ADD CONSTRAINT "inventory_reserved_within_stock" CHECK (
        "quantity_reserved" <= "quantity_on_hand" OR "allow_backorder"
    ),
    ADD CONSTRAINT "inventory_threshold_non_negative" CHECK ("low_stock_threshold" >= 0);

-- Low-stock dashboard query (docs/04 §13 #13).
CREATE INDEX "inventory_available_idx"
    ON "inventory" (("quantity_on_hand" - "quantity_reserved"));

ALTER TABLE "inventory_movements"
    -- A zero-quantity movement is meaningless and hides real bugs.
    ADD CONSTRAINT "inventory_movements_delta_non_zero" CHECK ("quantity_delta" <> 0),
    ADD CONSTRAINT "inventory_movements_after_non_negative" CHECK ("quantity_after" >= 0);

-- ── Payments ─────────────────────────────────────────────────────────────
ALTER TABLE "payments"
    ADD CONSTRAINT "payments_amount_non_negative" CHECK ("amount_paise" >= 0),
    ADD CONSTRAINT "payments_paid_within_amount"
        CHECK ("amount_paid_paise" >= 0 AND "amount_paid_paise" <= "amount_paise"),
    -- You cannot refund more than was actually collected (BR-P6).
    ADD CONSTRAINT "payments_refunded_within_paid"
        CHECK ("amount_refunded_paise" >= 0 AND "amount_refunded_paise" <= "amount_paid_paise"),
    ADD CONSTRAINT "payments_currency_iso4217" CHECK ("currency" ~ '^[A-Z]{3}$');

ALTER TABLE "refunds"
    ADD CONSTRAINT "refunds_amount_positive" CHECK ("amount_paise" > 0);

ALTER TABLE "payment_attempts"
    ADD CONSTRAINT "payment_attempts_amount_non_negative" CHECK ("amount_paise" >= 0);

-- ── Engagement ───────────────────────────────────────────────────────────
ALTER TABLE "notification_outbox"
    ADD CONSTRAINT "notification_outbox_attempts_non_negative" CHECK ("attempts" >= 0);

-- Dispatch claims rows with FOR UPDATE SKIP LOCKED against this index.
CREATE INDEX "notification_outbox_dispatchable_idx"
    ON "notification_outbox" ("next_attempt_at")
    WHERE "status" IN ('PENDING', 'FAILED');

CREATE INDEX "notifications_unread_idx"
    ON "notifications" ("user_id") WHERE "read_at" IS NULL;

ALTER TABLE "favorites"
    ADD CONSTRAINT "favorites_exactly_one_target" CHECK (
        ("product_id" IS NOT NULL AND "combo_id" IS NULL) OR
        ("product_id" IS NULL AND "combo_id" IS NOT NULL)
    );

ALTER TABLE "reviews"
    ADD CONSTRAINT "reviews_rating_range" CHECK ("rating" BETWEEN 1 AND 5);

-- ── Coupons ──────────────────────────────────────────────────────────────
ALTER TABLE "coupons"
    ADD CONSTRAINT "coupons_discount_value_positive" CHECK ("discount_value" > 0),
    ADD CONSTRAINT "coupons_percentage_within_range" CHECK (
        "discount_type" <> 'PERCENTAGE' OR "discount_value" <= 10000
    ),
    ADD CONSTRAINT "coupons_validity_window" CHECK (
        "valid_until" IS NULL OR "valid_from" IS NULL OR "valid_until" >= "valid_from"
    ),
    ADD CONSTRAINT "coupons_used_count_non_negative" CHECK ("used_count" >= 0);

-- ── Audit log: append-only ───────────────────────────────────────────────
-- Enforced by trigger rather than by GRANT, so it holds regardless of which
-- role connects. An audit trail that can be rewritten is not an audit trail
-- (BR-SEC14).
CREATE OR REPLACE FUNCTION "audit_logs_append_only"() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'audit_logs is append-only: % is not permitted', TG_OP
        USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "audit_logs_no_update"
    BEFORE UPDATE ON "audit_logs"
    FOR EACH ROW EXECUTE FUNCTION "audit_logs_append_only"();

CREATE TRIGGER "audit_logs_no_delete"
    BEFORE DELETE ON "audit_logs"
    FOR EACH ROW EXECUTE FUNCTION "audit_logs_append_only"();

-- Same guarantee for the two domain histories that exist to be trusted.
CREATE TRIGGER "order_status_history_no_update"
    BEFORE UPDATE ON "order_status_history"
    FOR EACH ROW EXECUTE FUNCTION "audit_logs_append_only"();

CREATE TRIGGER "inventory_movements_no_update"
    BEFORE UPDATE ON "inventory_movements"
    FOR EACH ROW EXECUTE FUNCTION "audit_logs_append_only"();
