-- PHASE 03 — email/password authentication (docs/07, ADR-010 superseded for
-- the CURRENT phase; Firebase remains a documented FUTURE option, see
-- docs/36 ADR-037).
--
-- Entirely additive. No column is dropped, no existing row is touched, no
-- data is destroyed. Safe to run against a database that already has rows
-- with `firebase_uid` set and no `password_hash` (ADR-038): those rows keep
-- working exactly as they do today until this migration lands, and go
-- through the password-setup flow to acquire a `password_hash` afterwards —
-- there is no default password anywhere in this file.

-- `firebase_uid` becomes optional: new PHASE 03 rows never populate it.
ALTER TABLE "users" ALTER COLUMN "firebase_uid" DROP NOT NULL;

-- The password login credential. Nullable: existing rows start with none,
-- and the password-setup/reset flow is the only path that ever sets it.
ALTER TABLE "users" ADD COLUMN "password_hash" TEXT;

-- Email becomes a second identity key, alongside the existing
-- (firebase_uid, user_type) key. Postgres treats every NULL as distinct from
-- every other NULL in a unique index, so this does not block the existing
-- phone-only / email-less rows — it only guards against two rows sharing
-- the same (email, user_type) once an email is actually set.
--
-- Fix #6 (migration preflight): the index below FAILS outright if any two
-- existing rows already share a non-null (email, user_type) pair. The
-- block immediately below turns that generic "duplicate key value
-- violates unique constraint" failure into one that names the exact
-- duplicates and the remediation query, BEFORE the index build even
-- starts — fail explicit and actionable, not silently discard data (this
-- migration still makes no writes beyond its own schema changes; the
-- RAISE aborts the whole transaction, so nothing above this line is
-- applied either if it fires).
--
-- This is also checkable ahead of any deploy, read-only, with:
--   pnpm db:check-duplicate-emails
-- (packages/db/scripts/check-duplicate-emails.mjs — the same query below,
-- runnable against a replica/staging clone with zero risk, before this
-- migration is ever attempted against a database that might fail it.)
--
-- Neither this guard nor the standalone script merges, renames or deletes
-- any row — every resolution is a manual, human judgement call about real
-- user data (see the script's own header for the exact remediation steps).
DO $$
DECLARE
  dup_count integer;
BEGIN
  SELECT COUNT(*) INTO dup_count FROM (
    SELECT email, user_type
    FROM "users"
    WHERE email IS NOT NULL
    GROUP BY email, user_type
    HAVING COUNT(*) > 1
  ) AS duplicates;

  IF dup_count > 0 THEN
    RAISE EXCEPTION 'PHASE 03 migration aborted: % existing (email, user_type) pair(s) are duplicated and would violate the new unique index users_email_user_type_key. Run: SELECT email, user_type, COUNT(*) FROM users WHERE email IS NOT NULL GROUP BY email, user_type HAVING COUNT(*) > 1; (or `pnpm db:check-duplicate-emails`) to find them, then resolve each manually — merge, rename, or null the email on one — before re-running this migration. No rows were modified by this check.', dup_count;
  END IF;
END $$;

CREATE UNIQUE INDEX "users_email_user_type_key" ON "users"("email", "user_type");

-- CreateEnum
CREATE TYPE "password_reset_purpose" AS ENUM ('SETUP', 'RESET');

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),
    "ip_address" TEXT,
    "user_agent" TEXT,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "purpose" "password_reset_purpose" NOT NULL DEFAULT 'RESET',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens"("user_id");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
