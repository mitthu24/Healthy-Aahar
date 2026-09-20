import { env } from '@/lib/env';

/**
 * PHASE 01 foundation shell.
 *
 * The admin console is PHASE 04, and the Cities / Pincodes screens that make
 * serviceability admin-controlled arrive with it. The navigation below is
 * rendered to document the intended information architecture
 * (docs/15-ADMIN-UX.md §2) — nothing is wired up yet.
 */
const MODULES = [
  {
    group: 'Operations',
    items: ['Orders', 'Subscriptions', 'Deliveries', 'Exceptions'],
    phase: '07–09',
  },
  { group: 'Catalogue', items: ['Products', 'Categories', 'Combos', 'Inventory'], phase: '05–08' },
  { group: 'Delivery', items: ['Cities', 'Pincodes', 'Zones', 'Slots'], phase: '04–06' },
  { group: 'Settings', items: ['Admin users', 'Roles', 'Audit log'], phase: '03–04' },
] as const;

export default function HomePage() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <p className="text-caption font-semibold uppercase tracking-wide text-green-600">
        Phase 01 — Foundation
      </p>

      <h1 className="font-display text-heading-lg text-sand-900 mt-3">Healthy Aahar Operations</h1>

      <p className="text-body-md text-sand-600 mt-4 max-w-2xl">
        Admin shell in place. Authentication and RBAC land in Phase 03; the modules below follow in
        their phases. Cities and Pincodes become the source of truth for serviceability.
      </p>

      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        {MODULES.map((module) => (
          <section
            key={module.group}
            className="border-sand-200 bg-sand-0 rounded-lg border p-5 shadow-sm"
          >
            <div className="flex items-baseline justify-between">
              <h2 className="text-heading-sm text-sand-900">{module.group}</h2>
              <span className="text-caption text-sand-400">Phase {module.phase}</span>
            </div>
            <ul className="mt-3 space-y-1">
              {module.items.map((item) => (
                <li key={item} className="text-body-sm text-sand-600">
                  {item}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <p className="text-body-sm text-sand-400 mt-8">
        Environment: <span className="tabular">{env.NEXT_PUBLIC_APP_ENV}</span>
      </p>
    </main>
  );
}
