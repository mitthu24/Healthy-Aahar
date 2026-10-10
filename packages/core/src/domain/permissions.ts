/**
 * The permission catalogue and the seven system roles (docs/08-RBAC-PERMISSIONS.md).
 *
 * Permissions are CODE, not data — they are a contract with the routes
 * (ADR-019 as referenced in doc 08 §1). This module is the single source
 * both the permissions migration and the role seed read from, so the
 * catalogue in the docs, the database and the enforcement layer cannot drift
 * from one another.
 */

export type PermissionDefinition = {
  key: string;
  resource: string;
  action: string;
  description: string;
};

function perm(key: string, description: string): PermissionDefinition {
  const [resource, action] = key.split(':');
  if (!resource || !action) {
    throw new Error(`Permission key "${key}" is not in resource:action form`);
  }
  return { key, resource, action, description };
}

export const PERMISSIONS: readonly PermissionDefinition[] = [
  perm('dashboard:read', 'View the operations dashboard'),
  perm('reports:read', 'View sales, product, subscription and customer reports'),
  perm('reports:export', 'Download CSV/XLSX exports'),

  perm('orders:read', 'List and view orders, prep lists, dispatch manifests'),
  perm('orders:update_status', 'Move an order through the lifecycle'),
  perm('orders:update', 'Edit internal notes, reassign slot'),
  perm('orders:cancel', 'Cancel an order'),
  perm('orders:refund', 'Initiate a refund'),

  perm('subscriptions:read', 'List and view subscriptions and deliveries'),
  perm(
    'subscriptions:update',
    "Pause, resume, change quantity/slot/address on a customer's behalf",
  ),
  perm('subscriptions:cancel', 'Cancel a subscription'),
  perm('subscriptions:manage_plans', 'Create and edit subscription plans'),

  perm('catalog:read', 'View categories, products, variants, combos'),
  perm('catalog:create', 'Create catalogue entities'),
  perm('catalog:update', 'Edit catalogue entities, including price'),
  perm('catalog:delete', 'Soft-delete catalogue entities'),
  perm('catalog:publish', 'Move a product between DRAFT and ACTIVE'),

  perm('inventory:read', 'View stock levels and movement history'),
  perm('inventory:adjust', 'Adjust stock, record wastage'),
  perm('inventory:settings', 'Change thresholds and tracking flags'),

  perm('customers:read', 'List and view customers (contact details masked)'),
  perm('customers:read_pii', 'Unmask phone and email — audited on every unmask'),
  perm('customers:update', 'Edit internal notes'),
  perm('customers:suspend', 'Suspend or reactivate an account'),

  perm('delivery:read', 'View zones, slots, capacity, holidays'),
  perm('delivery:manage', 'Create and edit zones, slots, capacity overrides, holidays'),

  perm('payments:read', 'View payment records'),
  perm('payments:collect', 'Mark COD as collected'),
  perm('payments:refund', 'Issue refunds'),

  perm('promotions:read', 'View coupons and campaigns'),
  perm('promotions:manage', 'Manage coupons and campaigns'),

  perm('content:read', 'View banners, FAQ, blog, policy pages'),
  perm('content:manage', 'Manage banners, FAQ, blog, policy pages'),
  perm('reviews:moderate', 'Approve or reject reviews'),

  perm('admin_users:read', 'View staff accounts'),
  perm('admin_users:create', 'Invite staff'),
  perm('admin_users:update', 'Edit staff, assign roles'),
  perm('admin_users:deactivate', 'Deactivate staff'),
  perm('roles:read', 'View roles and permissions'),
  perm('roles:manage', 'Create roles and change their permissions — Super Admin only'),
  perm('settings:read', 'View runtime configuration'),
  perm('settings:update', 'Change runtime configuration'),
  perm('audit:read', 'View audit logs'),
  perm('notifications:send', 'Send a manual notification to a customer'),
] as const;

export const PERMISSION_KEYS: ReadonlySet<string> = new Set(PERMISSIONS.map((p) => p.key));

export function isKnownPermission(key: string): boolean {
  return PERMISSION_KEYS.has(key);
}

/** Expands a `resource:*` shorthand against the real catalogue. Test/seed helper. */
function expand(...patterns: string[]): string[] {
  const out = new Set<string>();
  for (const pattern of patterns) {
    if (pattern.endsWith(':*')) {
      const resource = pattern.slice(0, -2);
      for (const p of PERMISSIONS) if (p.resource === resource) out.add(p.key);
    } else {
      out.add(pattern);
    }
  }
  return [...out];
}

export type SystemRoleDefinition = {
  key: string;
  name: string;
  description: string;
  permissions: readonly string[];
};

/**
 * Seven roles at MVP (doc 08 §3). `is_system = true` for all of these — they
 * cannot be deleted or renamed (BR-SEC9); an owner can still create
 * additional, non-system roles from the admin panel.
 */
export const SYSTEM_ROLES: readonly SystemRoleDefinition[] = [
  {
    key: 'SUPER_ADMIN',
    name: 'Super Admin',
    description: 'Owner/founder. Bypasses all permission checks via is_super_admin.',
    // Super Admin's bypass is enforced in code (isSuperAdmin), not via this
    // list, but roles:manage is still granted explicitly so the row is
    // meaningful if is_super_admin is ever unset by mistake — fail closed,
    // not open.
    permissions: expand(
      'roles:*',
      'admin_users:*',
      'settings:read',
      'settings:update',
      'audit:read',
    ),
  },
  {
    key: 'ADMIN',
    name: 'Admin',
    description: 'General manager. Everything operational except role management.',
    permissions: expand(
      'dashboard:read',
      'reports:read',
      'reports:export',
      'orders:*',
      'subscriptions:*',
      'catalog:*',
      'inventory:read',
      'inventory:adjust',
      'inventory:settings',
      'customers:read',
      'customers:read_pii',
      'customers:update',
      'customers:suspend',
      'delivery:read',
      'delivery:manage',
      'payments:read',
      'payments:collect',
      'admin_users:read',
      'admin_users:create',
      'admin_users:update',
      'admin_users:deactivate',
      'settings:read',
      'settings:update',
      'audit:read',
      'notifications:send',
      'content:manage',
      'content:read',
    ),
  },
  {
    key: 'OPERATIONS_MANAGER',
    name: 'Operations Manager',
    description: 'Runs the daily fulfilment cycle.',
    permissions: expand(
      'dashboard:read',
      'reports:read',
      'orders:read',
      'orders:update_status',
      'orders:update',
      'orders:cancel',
      'subscriptions:read',
      'subscriptions:update',
      'catalog:read',
      'inventory:read',
      'inventory:adjust',
      'customers:read',
      'customers:read_pii',
      'delivery:read',
      'delivery:manage',
      'payments:read',
      'payments:collect',
      'notifications:send',
    ),
  },
  {
    key: 'INVENTORY_MANAGER',
    name: 'Inventory Manager',
    description: 'Kitchen and stock.',
    permissions: expand(
      'dashboard:read',
      'catalog:read',
      'catalog:update',
      'inventory:read',
      'inventory:adjust',
      'inventory:settings',
      'orders:read',
    ),
  },
  {
    key: 'ORDER_MANAGER',
    name: 'Order Manager',
    description: 'Order desk only.',
    permissions: expand(
      'dashboard:read',
      'orders:read',
      'orders:update_status',
      'orders:update',
      'catalog:read',
      'customers:read',
      'delivery:read',
      'payments:read',
    ),
  },
  {
    key: 'CUSTOMER_SUPPORT',
    name: 'Customer Support',
    description: "Handles customer contact and can act on a customer's behalf within limits.",
    permissions: expand(
      'orders:read',
      'orders:cancel',
      'subscriptions:read',
      'subscriptions:update',
      'subscriptions:cancel',
      'customers:read',
      'customers:read_pii',
      'customers:update',
      'catalog:read',
      'delivery:read',
      'payments:read',
      'notifications:send',
    ),
  },
  {
    key: 'CONTENT_MANAGER',
    name: 'Content Manager',
    description: 'Catalogue content and merchandising.',
    permissions: expand(
      'catalog:read',
      'catalog:create',
      'catalog:update',
      'catalog:publish',
      'content:read',
      'content:manage',
      'reviews:moderate',
      'promotions:read',
    ),
  },
] as const;
