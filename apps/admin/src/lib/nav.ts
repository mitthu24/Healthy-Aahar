import {
  AuditIcon,
  CategoriesIcon,
  CustomersIcon,
  DashboardIcon,
  DeliveryIcon,
  EmployeesIcon,
  OrdersIcon,
  ProductsIcon,
  RolesIcon,
  SlotsIcon,
} from '@/components/shell/icons';

export type NavItem = {
  href: string;
  label: string;
  icon: typeof DashboardIcon;
  /** Omitted = visible to every authenticated admin (matches the old flat nav's behavior for Orders/Products/Categories/Slots). */
  permission?: string;
};

export type NavGroup = { label: string; items: NavItem[] };

/**
 * Single source of truth for the sidebar, mobile drawer and bottom nav.
 * Every href here is a route that actually exists today — modules not yet
 * built (inventory UI, subscriptions, finance, reports, settings) are left
 * out entirely rather than linked as "coming soon" placeholders.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Overview',
    items: [{ href: '/', label: 'Dashboard', icon: DashboardIcon, permission: 'dashboard:read' }],
  },
  {
    label: 'Operations',
    items: [
      { href: '/orders', label: 'Orders', icon: OrdersIcon },
      {
        href: '/delivery-partners',
        label: 'Delivery Partners',
        icon: DeliveryIcon,
        permission: 'delivery_partners:read',
      },
      { href: '/delivery-slots', label: 'Delivery Slots', icon: SlotsIcon },
      { href: '/customers', label: 'Customers', icon: CustomersIcon, permission: 'customers:read' },
    ],
  },
  {
    label: 'Catalog',
    items: [
      { href: '/products', label: 'Products', icon: ProductsIcon },
      { href: '/categories', label: 'Categories', icon: CategoriesIcon },
    ],
  },
  {
    label: 'Administration',
    items: [
      {
        href: '/employees',
        label: 'Employees',
        icon: EmployeesIcon,
        permission: 'admin_users:read',
      },
      { href: '/roles', label: 'Roles & Permissions', icon: RolesIcon, permission: 'roles:read' },
      { href: '/audit-log', label: 'Audit Log', icon: AuditIcon, permission: 'audit:read' },
    ],
  },
];

/** Top 4 items for the mobile bottom bar — the sections a founder checks most often. */
export const BOTTOM_NAV_HREFS = ['/', '/orders', '/delivery-partners', '/employees'];

export function isNavItemActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Matches the API's own `requirePermission` middleware exactly: a Super
 * Admin bypasses every permission check (`actor.isSuperAdmin ||
 * actor.permissions.has(required)`), never just the keys their role
 * happens to list explicitly. The seeded SUPER_ADMIN role deliberately
 * grants only a minimal permission set rather than the full catalogue
 * (packages/core/src/domain/permissions.ts's own doc comment: so an
 * accidentally-unset `is_super_admin` flag fails closed instead of
 * silently keeping broad access via a stale explicit grant) — so nav
 * visibility has to check the bypass itself, not just the permission set,
 * or a genuine founder's own account would see fewer modules than their
 * account can actually use.
 */
export function isNavItemVisible(
  item: NavItem,
  permissions: Set<string> | null,
  isSuperAdmin: boolean,
): boolean {
  return !item.permission || isSuperAdmin || permissions?.has(item.permission) === true;
}
