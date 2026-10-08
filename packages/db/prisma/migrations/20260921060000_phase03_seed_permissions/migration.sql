-- PHASE 03 — seed the static permission catalogue (docs/08-RBAC-PERMISSIONS.md §1, §2).
--
-- Permissions are CODE, not data: this migration is generated from
-- packages/core/src/domain/permissions.ts (the single source of truth both
-- this file and the runtime enforcement layer read from) so the catalogue in
-- the docs, the database and the route-level checks cannot drift from one
-- another. `ON CONFLICT DO NOTHING` makes this safe to include verbatim if a
-- future migration ever needs to re-run it.

INSERT INTO "permissions" ("id", "key", "resource", "action", "description", "created_at") VALUES
  (gen_random_uuid(), 'dashboard:read', 'dashboard', 'read', 'View the operations dashboard', now()),
  (gen_random_uuid(), 'reports:read', 'reports', 'read', 'View sales, product, subscription and customer reports', now()),
  (gen_random_uuid(), 'reports:export', 'reports', 'export', 'Download CSV/XLSX exports', now()),
  (gen_random_uuid(), 'orders:read', 'orders', 'read', 'List and view orders, prep lists, dispatch manifests', now()),
  (gen_random_uuid(), 'orders:update_status', 'orders', 'update_status', 'Move an order through the lifecycle', now()),
  (gen_random_uuid(), 'orders:update', 'orders', 'update', 'Edit internal notes, reassign slot', now()),
  (gen_random_uuid(), 'orders:cancel', 'orders', 'cancel', 'Cancel an order', now()),
  (gen_random_uuid(), 'orders:refund', 'orders', 'refund', 'Initiate a refund', now()),
  (gen_random_uuid(), 'subscriptions:read', 'subscriptions', 'read', 'List and view subscriptions and deliveries', now()),
  (gen_random_uuid(), 'subscriptions:update', 'subscriptions', 'update', 'Pause, resume, change quantity/slot/address on a customer''s behalf', now()),
  (gen_random_uuid(), 'subscriptions:cancel', 'subscriptions', 'cancel', 'Cancel a subscription', now()),
  (gen_random_uuid(), 'subscriptions:manage_plans', 'subscriptions', 'manage_plans', 'Create and edit subscription plans', now()),
  (gen_random_uuid(), 'catalog:read', 'catalog', 'read', 'View categories, products, variants, combos', now()),
  (gen_random_uuid(), 'catalog:create', 'catalog', 'create', 'Create catalogue entities', now()),
  (gen_random_uuid(), 'catalog:update', 'catalog', 'update', 'Edit catalogue entities, including price', now()),
  (gen_random_uuid(), 'catalog:delete', 'catalog', 'delete', 'Soft-delete catalogue entities', now()),
  (gen_random_uuid(), 'catalog:publish', 'catalog', 'publish', 'Move a product between DRAFT and ACTIVE', now()),
  (gen_random_uuid(), 'inventory:read', 'inventory', 'read', 'View stock levels and movement history', now()),
  (gen_random_uuid(), 'inventory:adjust', 'inventory', 'adjust', 'Adjust stock, record wastage', now()),
  (gen_random_uuid(), 'inventory:settings', 'inventory', 'settings', 'Change thresholds and tracking flags', now()),
  (gen_random_uuid(), 'customers:read', 'customers', 'read', 'List and view customers (contact details masked)', now()),
  (gen_random_uuid(), 'customers:read_pii', 'customers', 'read_pii', 'Unmask phone and email — audited on every unmask', now()),
  (gen_random_uuid(), 'customers:update', 'customers', 'update', 'Edit internal notes', now()),
  (gen_random_uuid(), 'customers:suspend', 'customers', 'suspend', 'Suspend or reactivate an account', now()),
  (gen_random_uuid(), 'delivery:read', 'delivery', 'read', 'View zones, slots, capacity, holidays', now()),
  (gen_random_uuid(), 'delivery:manage', 'delivery', 'manage', 'Create and edit zones, slots, capacity overrides, holidays', now()),
  (gen_random_uuid(), 'payments:read', 'payments', 'read', 'View payment records', now()),
  (gen_random_uuid(), 'payments:collect', 'payments', 'collect', 'Mark COD as collected', now()),
  (gen_random_uuid(), 'payments:refund', 'payments', 'refund', 'Issue refunds', now()),
  (gen_random_uuid(), 'promotions:read', 'promotions', 'read', 'View coupons and campaigns', now()),
  (gen_random_uuid(), 'promotions:manage', 'promotions', 'manage', 'Manage coupons and campaigns', now()),
  (gen_random_uuid(), 'content:read', 'content', 'read', 'View banners, FAQ, blog, policy pages', now()),
  (gen_random_uuid(), 'content:manage', 'content', 'manage', 'Manage banners, FAQ, blog, policy pages', now()),
  (gen_random_uuid(), 'reviews:moderate', 'reviews', 'moderate', 'Approve or reject reviews', now()),
  (gen_random_uuid(), 'admin_users:read', 'admin_users', 'read', 'View staff accounts', now()),
  (gen_random_uuid(), 'admin_users:create', 'admin_users', 'create', 'Invite staff', now()),
  (gen_random_uuid(), 'admin_users:update', 'admin_users', 'update', 'Edit staff, assign roles', now()),
  (gen_random_uuid(), 'admin_users:deactivate', 'admin_users', 'deactivate', 'Deactivate staff', now()),
  (gen_random_uuid(), 'roles:read', 'roles', 'read', 'View roles and permissions', now()),
  (gen_random_uuid(), 'roles:manage', 'roles', 'manage', 'Create roles and change their permissions — Super Admin only', now()),
  (gen_random_uuid(), 'settings:read', 'settings', 'read', 'View runtime configuration', now()),
  (gen_random_uuid(), 'settings:update', 'settings', 'update', 'Change runtime configuration', now()),
  (gen_random_uuid(), 'audit:read', 'audit', 'read', 'View audit logs', now()),
  (gen_random_uuid(), 'notifications:send', 'notifications', 'send', 'Send a manual notification to a customer', now())
ON CONFLICT ("key") DO NOTHING;
