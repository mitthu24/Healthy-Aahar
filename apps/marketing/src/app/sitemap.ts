import type { MetadataRoute } from 'next';

import { apiClient } from '@/lib/api-client';
import { env } from '@/lib/env';

const STATIC_ROUTES = [
  '',
  '/products',
  '/subscriptions',
  '/how-it-works',
  '/about',
  '/contact',
  '/faq',
  '/terms',
  '/privacy',
  '/refund-policy',
  '/delivery-policy',
];

/** Generated from the real catalogue (docs/16 §7) — no hard-coded product list. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = env.NEXT_PUBLIC_MARKETING_URL;
  // A build-time timestamp, not business logic — no Clock to inject here
  // (ADR-007 is about domain logic; this mirrors the same exception already
  // made in packages/db/src/testing.ts for non-domain timestamps).
  // eslint-disable-next-line no-restricted-syntax
  const now = new Date();

  const staticEntries: MetadataRoute.Sitemap = STATIC_ROUTES.map((path) => ({
    url: `${base}${path}`,
    lastModified: now,
    changeFrequency: path === '' ? 'daily' : 'weekly',
    priority: path === '' ? 1 : 0.6,
  }));

  try {
    const { data: categories } = await apiClient.listCategories();
    const categoryEntries: MetadataRoute.Sitemap = categories.map((category) => ({
      url: `${base}/products?category=${category.id}`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.5,
    }));
    return [...staticEntries, ...categoryEntries];
  } catch {
    // Degrade to the static route list rather than a failed build (BR-MK6).
    return staticEntries;
  }
}
