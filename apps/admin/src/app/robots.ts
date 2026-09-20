import type { MetadataRoute } from 'next';

/** Nothing behind authentication is ever indexable (BR-SEO1). */
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: '*', disallow: '/' }] };
}
