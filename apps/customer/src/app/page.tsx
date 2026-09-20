import { env } from '@/lib/env';

/**
 * PHASE 01 foundation shell.
 *
 * The customer experience is PHASE 10. This page exists only to prove the app
 * builds, is themed by the shared design system, and is correctly pointed at
 * the API. It is `noindex` at both the app and the edge (BR-SEO1).
 */
export default function HomePage() {
  return (
    <main className="mx-auto max-w-lg px-4 py-16">
      <p className="text-caption font-semibold uppercase tracking-wide text-green-600">
        Phase 01 — Foundation
      </p>

      <h1 className="font-display text-heading-lg text-sand-900 mt-3">Healthy Aahar</h1>

      <p className="text-body-md text-sand-600 mt-4">
        The customer application shell is in place. Browsing, cart, checkout and subscriptions
        arrive in later phases.
      </p>

      <dl className="border-sand-200 bg-sand-0 text-body-sm mt-10 space-y-3 rounded-lg border p-5 shadow-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-sand-600">Environment</dt>
          <dd className="tabular text-sand-800">{env.NEXT_PUBLIC_APP_ENV}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-sand-600">API</dt>
          <dd className="tabular text-sand-800">{env.NEXT_PUBLIC_API_BASE_URL}</dd>
        </div>
      </dl>
    </main>
  );
}
