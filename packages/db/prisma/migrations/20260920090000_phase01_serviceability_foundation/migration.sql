-- PHASE 01 — Serviceability foundation
--
-- Creates the governance tables and the admin-controlled city/pincode
-- serviceability model (ADR-023, ADR-024).
--
-- Hand-reviewed: Prisma cannot express CHECK constraints or partial indexes,
-- so those are written explicitly below. They are not decoration — they are
-- the mechanism that makes bad state impossible rather than merely unlikely
-- (ADR-020).

-- ── Extensions ───────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "citext";

-- ── Enums ────────────────────────────────────────────────────────────────
CREATE TYPE "account_status" AS ENUM ('ACTIVE', 'SUSPENDED', 'DEACTIVATED');
CREATE TYPE "serviceability_status" AS ENUM ('ACTIVE', 'INACTIVE', 'COMING_SOON');
CREATE TYPE "job_run_status" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- ── businesses ───────────────────────────────────────────────────────────
CREATE TABLE "businesses" (
    "id"            UUID            NOT NULL,
    "name"          TEXT            NOT NULL,
    "slug"          CITEXT          NOT NULL,
    "timezone"      TEXT            NOT NULL DEFAULT 'Asia/Kolkata',
    "currency"      TEXT            NOT NULL DEFAULT 'INR',
    "support_email" CITEXT,
    "support_phone" TEXT,
    "status"        "account_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at"    TIMESTAMPTZ(6)  NOT NULL DEFAULT now(),
    "updated_at"    TIMESTAMPTZ(6)  NOT NULL,

    CONSTRAINT "businesses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "businesses_slug_key" ON "businesses" ("slug");

ALTER TABLE "businesses"
    ADD CONSTRAINT "businesses_name_not_blank" CHECK (length(btrim("name")) > 0),
    ADD CONSTRAINT "businesses_currency_iso4217" CHECK ("currency" ~ '^[A-Z]{3}$');

-- ── settings ─────────────────────────────────────────────────────────────
CREATE TABLE "settings" (
    "id"          UUID           NOT NULL,
    "business_id" UUID           NOT NULL,
    "key"         CITEXT         NOT NULL,
    "value"       JSONB          NOT NULL,
    "description" TEXT,
    "is_public"   BOOLEAN        NOT NULL DEFAULT false,
    "updated_by"  UUID,
    "created_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at"  TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "settings_business_id_key_key" ON "settings" ("business_id", "key");
CREATE INDEX "settings_business_id_is_public_idx" ON "settings" ("business_id", "is_public");

ALTER TABLE "settings"
    ADD CONSTRAINT "settings_business_id_fkey"
        FOREIGN KEY ("business_id") REFERENCES "businesses"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── job_runs ─────────────────────────────────────────────────────────────
CREATE TABLE "job_runs" (
    "id"              UUID             NOT NULL,
    "job_name"        TEXT             NOT NULL,
    "started_at"      TIMESTAMPTZ(6)   NOT NULL,
    "finished_at"     TIMESTAMPTZ(6),
    "status"          "job_run_status" NOT NULL DEFAULT 'RUNNING',
    "items_processed" INTEGER          NOT NULL DEFAULT 0,
    "error"           TEXT,
    "metadata"        JSONB,
    "created_at"      TIMESTAMPTZ(6)   NOT NULL DEFAULT now(),

    CONSTRAINT "job_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "job_runs_job_name_started_at_idx" ON "job_runs" ("job_name", "started_at" DESC);

ALTER TABLE "job_runs"
    ADD CONSTRAINT "job_runs_items_processed_non_negative" CHECK ("items_processed" >= 0),
    ADD CONSTRAINT "job_runs_finished_after_started"
        CHECK ("finished_at" IS NULL OR "finished_at" >= "started_at");

-- ── cities ───────────────────────────────────────────────────────────────
CREATE TABLE "cities" (
    "id"            UUID                    NOT NULL,
    "business_id"   UUID                    NOT NULL,
    "name"          TEXT                    NOT NULL,
    "slug"          CITEXT                  NOT NULL,
    "display_name"  TEXT,
    "state"         TEXT                    NOT NULL,
    "country"       TEXT                    NOT NULL DEFAULT 'IN',
    "timezone"      TEXT                    NOT NULL DEFAULT 'Asia/Kolkata',
    "status"        "serviceability_status" NOT NULL DEFAULT 'INACTIVE',
    "display_order" INTEGER                 NOT NULL DEFAULT 0,
    "activated_at"  TIMESTAMPTZ(6),
    "created_at"    TIMESTAMPTZ(6)          NOT NULL DEFAULT now(),
    "updated_at"    TIMESTAMPTZ(6)          NOT NULL,
    "created_by"    UUID,
    "updated_by"    UUID,

    CONSTRAINT "cities_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cities_business_id_slug_key" ON "cities" ("business_id", "slug");
CREATE INDEX "cities_business_id_status_idx" ON "cities" ("business_id", "status");
CREATE INDEX "cities_business_id_state_idx"  ON "cities" ("business_id", "state");

ALTER TABLE "cities"
    ADD CONSTRAINT "cities_business_id_fkey"
        FOREIGN KEY ("business_id") REFERENCES "businesses"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "cities_name_not_blank"  CHECK (length(btrim("name")) > 0),
    ADD CONSTRAINT "cities_state_not_blank" CHECK (length(btrim("state")) > 0),
    ADD CONSTRAINT "cities_country_iso3166" CHECK ("country" ~ '^[A-Z]{2}$'),
    -- An ACTIVE city must record when it went live. Without this, "since when
    -- have we served Noida" is unanswerable and reporting silently degrades.
    ADD CONSTRAINT "cities_active_requires_activated_at"
        CHECK ("status" <> 'ACTIVE' OR "activated_at" IS NOT NULL);

-- ── service_pincodes ─────────────────────────────────────────────────────
CREATE TABLE "service_pincodes" (
    "id"            UUID                    NOT NULL,
    "business_id"   UUID                    NOT NULL,
    "city_id"       UUID                    NOT NULL,
    "pincode"       TEXT                    NOT NULL,
    "area_name"     TEXT,
    "status"        "serviceability_status" NOT NULL DEFAULT 'INACTIVE',
    "display_order" INTEGER                 NOT NULL DEFAULT 0,
    "activated_at"  TIMESTAMPTZ(6),
    "created_at"    TIMESTAMPTZ(6)          NOT NULL DEFAULT now(),
    "updated_at"    TIMESTAMPTZ(6)          NOT NULL,
    "created_by"    UUID,
    "updated_by"    UUID,

    CONSTRAINT "service_pincodes_pkey" PRIMARY KEY ("id")
);

-- A pincode resolves to exactly one city per business, so "is this address
-- serviceable" has exactly one answer. This is the constraint that keeps
-- serviceability deterministic (BR-SV2).
CREATE UNIQUE INDEX "service_pincodes_business_id_pincode_key"
    ON "service_pincodes" ("business_id", "pincode");
CREATE INDEX "service_pincodes_city_id_status_idx"     ON "service_pincodes" ("city_id", "status");
CREATE INDEX "service_pincodes_business_id_status_idx" ON "service_pincodes" ("business_id", "status");

ALTER TABLE "service_pincodes"
    ADD CONSTRAINT "service_pincodes_business_id_fkey"
        FOREIGN KEY ("business_id") REFERENCES "businesses"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "service_pincodes_city_id_fkey"
        FOREIGN KEY ("city_id") REFERENCES "cities"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    -- Indian pincode: six digits, never leading zero.
    ADD CONSTRAINT "service_pincodes_format" CHECK ("pincode" ~ '^[1-9][0-9]{5}$'),
    ADD CONSTRAINT "service_pincodes_active_requires_activated_at"
        CHECK ("status" <> 'ACTIVE' OR "activated_at" IS NOT NULL);

-- A pincode and its city must belong to the same business. Without this
-- composite foreign key, a future multi-business bug could attach a Noida
-- pincode to another business's city and silently widen serviceability
-- (ADR-005, BR-SV3).
CREATE UNIQUE INDEX "cities_id_business_id_key" ON "cities" ("id", "business_id");

ALTER TABLE "service_pincodes"
    ADD CONSTRAINT "service_pincodes_city_same_business_fkey"
        FOREIGN KEY ("city_id", "business_id") REFERENCES "cities"("id", "business_id")
        ON DELETE RESTRICT ON UPDATE CASCADE;
