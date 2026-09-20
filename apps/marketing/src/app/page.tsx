import { env } from '@/lib/env';

/**
 * PHASE 01 foundation page.
 *
 * Deliberately minimal — the real marketing site is PHASE 12. What this page
 * exists to prove is the full vertical slice:
 *
 *   Next.js -> api.healthyaahar.com -> packages/core -> Prisma -> PostgreSQL
 *
 * The cities below are read from the database at request time. Nothing here
 * knows that the launch city is Noida; switch it off in the admin panel and
 * this list changes with no deploy (BR-SV1).
 */

type City = {
  id: string;
  name: string;
  slug: string;
  state: string;
  status: 'ACTIVE' | 'INACTIVE' | 'COMING_SOON';
  is_serviceable: boolean;
};

async function getCities(): Promise<{ cities: City[]; error: string | null }> {
  try {
    const res = await fetch(`${env.NEXT_PUBLIC_API_BASE_URL}/v1/public/cities`, {
      // Serviceability changes only when an admin changes it (docs/22 §5).
      next: { revalidate: 300 },
    });

    if (!res.ok) return { cities: [], error: `Service list unavailable (${res.status})` };

    const body = (await res.json()) as { data: City[] };
    return { cities: body.data, error: null };
  } catch {
    // The marketing site must never 500 because the backend hiccupped — it is
    // the top of the funnel and often a first impression (BR-MK6).
    return { cities: [], error: 'Service list is temporarily unavailable' };
  }
}

export default async function HomePage() {
  const { cities, error } = await getCities();
  const serviceable = cities.filter((c) => c.is_serviceable);

  return (
    <main className="mx-auto max-w-3xl px-4 py-16">
      <p className="text-caption font-semibold uppercase tracking-wide text-green-600">
        Phase 01 — Foundation
      </p>

      <h1 className="font-display text-display-sm text-sand-900 mt-3">Healthy Aahar</h1>

      <p className="text-body-lg text-sand-600 mt-4 max-w-xl">
        Fresh fruit, salads, sprouts and healthy meals — prepared the morning we deliver them,
        brought to you in a slot you choose.
      </p>

      <section className="border-sand-200 bg-sand-0 mt-12 rounded-lg border p-6 shadow-sm">
        <h2 className="text-heading-sm text-sand-900">Where we deliver</h2>

        {error ? (
          <p className="text-body-md text-sand-600 mt-3">{error}</p>
        ) : serviceable.length === 0 ? (
          <p className="text-body-md text-sand-600 mt-3">
            No cities are active yet. Add one in the admin panel — no deploy required.
          </p>
        ) : (
          <ul className="mt-4 space-y-2">
            {cities.map((city) => (
              <li key={city.id} className="flex items-center justify-between gap-4">
                <span className="text-body-md text-sand-800">
                  {city.name}
                  <span className="text-sand-400"> · {city.state}</span>
                </span>
                <span
                  className={
                    city.is_serviceable
                      ? 'bg-success-50 text-caption text-success-600 rounded-full px-3 py-1 font-medium'
                      : 'bg-warning-50 text-caption text-warning-600 rounded-full px-3 py-1 font-medium'
                  }
                >
                  {city.is_serviceable ? 'Delivering now' : 'Coming soon'}
                </span>
              </li>
            ))}
          </ul>
        )}

        <p className="text-body-sm text-sand-600 mt-5">
          This list is read from the database. Cities and pincodes are controlled entirely from the
          admin panel.
        </p>
      </section>
    </main>
  );
}
