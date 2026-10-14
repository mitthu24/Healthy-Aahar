import {
  AuditIcon,
  CategoriesIcon,
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
 * Every href here is a route that actually exists today — per Stage B scope,
 * modules not yet built (dashboard analytics, customers, inventory UI,
 * subscriptions, finance, reports, settings) are left out entirely rather
 * than linked as "coming soon" placeholders.
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
