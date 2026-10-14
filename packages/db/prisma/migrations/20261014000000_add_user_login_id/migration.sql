-- Stage C: an email-free login identifier for staff/delivery accounts a
-- founder creates without an email address. Nullable, additive-only — every
-- existing row keeps `login_id = NULL`, which Postgres treats as distinct
-- from every other NULL, so the new unique index is a no-op for all of them
-- and only starts enforcing uniqueness once a row actually sets one.
ALTER TABLE "users" ADD COLUMN "login_id" CITEXT;

CREATE UNIQUE INDEX "users_login_id_user_type_key" ON "users"("login_id", "user_type");
