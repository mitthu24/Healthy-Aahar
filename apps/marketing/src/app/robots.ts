import type { MetadataRoute } from 'next';

/**
 * Only the marketing site is indexable. The customer app and admin panel
 * disallow everything and additionally send X-Robots-Tag (BR-SEO1).
 */
export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_MARKETING_URL ?? 'https://healthyaahar.com';

  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/api/'] }],
    sitemap: `${base}/sitemap.xml`,
  };
}
