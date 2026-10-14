import { Card, ChartContainer, ChartPlaceholder, ResponsiveContainer } from '@healthy-aahar/ui';
import Link from 'next/link';

import {
  AuditIcon,
  DeliveryIcon,
  EmployeesIcon,
  OrdersIcon,
  ProductsIcon,
} from '@/components/shell/icons';

const QUICK_ACTIONS = [
  {
    href: '/orders',
    label: 'Orders',
    description: 'Review confirmed orders, update fulfilment, and record COD collection.',
    icon: OrdersIcon,
  },
  {
    href: '/delivery-partners',
    label: 'Delivery Partners',
    description: 'Create partner accounts, review duty status, and assign deliveries.',
    icon: DeliveryIcon,
  },
  {
    href: '/products',
    label: 'Products',
    description: 'Manage the catalogue, pricing, stock and images.',
    icon: ProductsIcon,
  },
  {
    href: '/employees',
    label: 'Employees',
    description: 'Invite staff and manage role-based access.',
    icon: EmployeesIcon,
  },
  {
    href: '/audit-log',
    label: 'Audit Log',
    description: 'Review recent sensitive changes across the business.',
    icon: AuditIcon,
  },
] as const;

/**
 * Admin console home / dashboard.
 *
 * Deliberately honest about what exists: no KPI numbers, trends or charts
 * are shown here, because no backend aggregation service computes them yet
 * (docs/15 §3, confirmed absent as of Stage A's gap matrix) — a fabricated
 * or wrongly-computed "Gross sales" figure would be worse than none. This
 * page is the entry point into the modules that are genuinely live today,
 * plus an explicit placeholder for where real analytics will land once the
 * aggregation service exists (a later stage, not a visual-only addition).
 */
export default function HomePage() {
  return (
    <main className="py-8">
      <ResponsiveContainer wide>
        <p className="text-caption font-semibold uppercase tracking-wide text-green-600">
          Healthy Aahar Operations
        </p>
        <h1 className="font-display text-heading-lg text-sand-900 mt-2">Welcome back</h1>
        <p className="text-body-sm text-sand-600 mt-1">
          A founder-level analytics dashboard (sales, orders, delivery performance) is planned for a
          later stage, once the backend aggregation it depends on is built. For now, here is every
          module that is live today.
        </p>

        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {QUICK_ACTIONS.map((action) => {
            const Icon = action.icon;
            return (
              <Link key={action.href} href={action.href}>
                <Card className="flex h-full items-start gap-3.5 p-5 transition-colors hover:border-green-300">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-green-50 text-green-700">
                    <Icon className="h-5 w-5" />
                  </span>
                  <div>
                    <h2 className="text-body-md text-sand-900 font-semibold">{action.label}</h2>
                    <p className="text-body-sm text-sand-600 mt-1">{action.description}</p>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>

        <div className="mt-8">
          <ChartContainer title="Sales trend" height="h-56">
            <ChartPlaceholder label="Analytics foundation in progress — no sales aggregation service exists yet" />
          </ChartContainer>
        </div>
      </ResponsiveContainer>
    </main>
  );
}
