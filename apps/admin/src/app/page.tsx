import { Button, Card } from '@healthy-aahar/ui';
import Link from 'next/link';

/**
 * Admin console home (Phase 04).
 *
 * A dashboard with real metrics is future work (docs/15 §3) — this is
 * deliberately just the entry point into the one module that exists today
 * (order fulfilment), rather than a dashboard showing numbers nobody built
 * yet.
 */
export default function HomePage() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <p className="text-caption font-semibold uppercase tracking-wide text-green-600">
        Healthy Aahar Operations
      </p>
      <h1 className="font-display text-heading-lg text-sand-900 mt-3">Welcome back</h1>

      <Card className="mt-8 flex items-center justify-between p-6">
        <div>
          <h2 className="text-heading-sm text-sand-900">Orders</h2>
          <p className="text-body-sm text-sand-600 mt-1">
            Review newly confirmed orders, update fulfilment, and record COD collection.
          </p>
        </div>
        <Link href="/orders">
          <Button>Open orders</Button>
        </Link>
      </Card>
    </main>
  );
}
