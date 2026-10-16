-- Stage F: database-backed unit catalogue, replacing the hardcoded
-- UNIT_CATALOG constant. Purely additive — no existing table or column is
-- touched, so every current product_variants.unit string keeps working
-- unchanged regardless of whether a matching row exists here yet (the
-- application-layer seed below back-fills one business_id row per
-- previously-hardcoded unit code, idempotently).

CREATE TYPE "unit_dimension" AS ENUM ('MASS', 'VOLUME', 'COUNT');

CREATE TABLE "units" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "dimension" "unit_dimension" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "units_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "units_business_id_code_key" ON "units"("business_id", "code");
CREATE INDEX "units_business_id_is_active_idx" ON "units"("business_id", "is_active");

ALTER TABLE "units" ADD CONSTRAINT "units_business_id_fkey"
    FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
