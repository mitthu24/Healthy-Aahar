-- Stage E: founder-assigned employee ID, unique within the business. Additive
-- only — every existing row keeps `employee_code = NULL`, which Postgres
-- treats as distinct from every other NULL, so this is a no-op for all of
-- them and only starts enforcing uniqueness once a row actually sets one.
CREATE UNIQUE INDEX "admin_users_business_id_employee_code_key" ON "admin_users"("business_id", "employee_code");
