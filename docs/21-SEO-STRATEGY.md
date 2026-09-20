# 21 — SEO Strategy

## 1. Indexing policy per surface

| Surface | Indexed | Mechanism |
|---|---|---|
| `maindomain.com` | ✅ Yes | Full SEO treatment |
| `app.maindomain.com` | ❌ No | `X-Robots-Tag: noindex, nofollow` on every response + `robots.txt` disallow all |
| `admin.maindomain.com` | ❌ No | Same, plus access restriction |
| `api.maindomain.com` | ❌ No | `X-Robots-Tag: noindex` on all responses |

**Why the customer app is `noindex`:** it duplicates the marketing site's product content
behind authentication. Indexing it would split link equity across two URLs for the same
product and expose authenticated shells to crawlers. The canonical public URL for a product
is always `maindomain.com/products/[slug]`, and the app's equivalent page declares that
canonical (BR-SEO1).

Enforced at the edge in Cloudflare **and** in each app's response headers — a single
mechanism is one misconfiguration away from indexing a customer's order page.

## 2. Keyword strategy

Local-intent commercial queries, not informational ones. We sell a delivery service in a
defined geography.

| Tier | Example | Target page |
|---|---|---|
| Category + city | "fresh cut fruit delivery bengaluru" | `/categories/fresh-cut-fruits` |
| Product + city | "fruit chaat delivery hsr layout" | `/products/fruit-chaat-bowl` |
| Service | "daily fruit subscription bangalore" | `/subscriptions` |
| Locality | "healthy food delivery koramangala" | `/delivery-areas` |
| Problem | "healthy breakfast delivery near me" | `/` |
| Informational (P2) | "benefits of sprouts for breakfast" | `/blog/*` |

Locality pages are the highest-leverage SEO asset for a delivery business and are generated
from `zone_pincodes.area_name` — so expanding into a new locality automatically produces its
landing page rather than requiring content work (P2).

## 3. Metadata

Generated per route with Next.js `generateMetadata`, from live API data.

```
Product : "{name} — Fresh {category} Delivered Daily | {Brand}"        ≤ 60 chars
Category: "{name} Home Delivery in {city} | {Brand}"
Home    : "{Brand} — Fresh Fruits, Salads & Healthy Food Delivered Daily"
```

Descriptions (≤ 155 chars) are generated from `short_description` plus price and slot
information, with a hand-written `seo_description` override available per product and
category (`products.seo_title`, `products.seo_description`).

Open Graph and Twitter cards on every page, with the product's primary image at 1200×630.
Social previews for a food business are a conversion surface, not an afterthought.

## 4. Structured data (JSON-LD)

| Schema | Where | Contents |
|---|---|---|
| `Organization` | All pages | Name, logo, contact, social |
| `LocalBusiness` / `FoodEstablishment` | Home, delivery-areas | Address, `areaServed` from zones, opening hours from slots |
| `Product` + `Offer` | Product pages | Name, image, description, SKU, `price`, `priceCurrency: INR`, `availability`, `priceValidUntil` |
| `ItemList` | Category pages | Ordered product list |
| `BreadcrumbList` | Category, product, combo | Full trail |
| `FAQPage` | `/faq`, home FAQ block | Q&A pairs |
| `WebSite` + `SearchAction` | Home | Sitelinks search box |
| `AggregateRating` | Product pages (P2) | Only once real reviews exist |

**Rule:** structured data is generated from the same API response that renders the page.
Hand-maintained JSON-LD drifts from reality, and advertising a price in a rich result that we
do not honour is both a trust failure and a policy violation (BR-SEO2).

`availability` maps from derived stock: `InStock` / `OutOfStock`. `AggregateRating` will not
be emitted until there are genuine reviews — fabricated ratings risk manual action.

## 5. URLs

```
/                                  home
/products                          all products
/products/fruit-chaat-bowl         product        ← slug, never an id
/categories                        index
/categories/fresh-cut-fruits       category
/combos/morning-wellness-combo     combo
/subscriptions/daily-fruit-chaat   plan
/delivery-areas/hsr-layout         locality (P2)
/blog/benefits-of-sprouts          article (P2)
```

Rules: lowercase, hyphenated, no ids, no query parameters in canonical URLs, no trailing
slash, filters and sorting use query strings and are `noindex, follow` to avoid
near-duplicate index bloat.

**Slug stability:** `products.slug` is immutable after publishing. If a name must change, the
slug stays and a 301 is registered in a `url_redirects` table (P2). Changing a slug silently
destroys accumulated ranking, so the system prevents it rather than trusting discipline.

## 6. Sitemaps and robots

`/sitemap.xml` is a sitemap index referencing:
`sitemap-static.xml`, `sitemap-products.xml`, `sitemap-categories.xml`,
`sitemap-combos.xml`, `sitemap-plans.xml`, `sitemap-blog.xml` (P2).

Generated dynamically from live `ACTIVE` entities with `lastmod` from `updated_at`, cached
for one hour. Unpublishing a product removes it from the sitemap on the next regeneration.

```
# maindomain.com/robots.txt
User-agent: *
Allow: /
Disallow: /api/
Disallow: /*?*sort=
Disallow: /*?*filter=
Sitemap: https://maindomain.com/sitemap.xml
```
```
# app. and admin. robots.txt
User-agent: *
Disallow: /
```

## 7. Technical SEO

- **Rendering:** SSG/ISR — full HTML with content in the initial response, no client-side
  hydration required for a crawler to see a price.
- **Canonical** on every page, self-referencing; the customer app's product page points its
  canonical at the marketing URL.
- **Core Web Vitals** are a ranking factor and are budgeted in doc 22 (LCP ≤ 1.8s p75).
- **Mobile-first indexing** — the site is mobile-first by design.
- **HTTPS everywhere**, HSTS with preload.
- **`hreflang`** not needed at launch (single locale `en-IN`); the structure allows adding it.
- **404s** return a real 404 with helpful navigation; never a soft 200.
- **Redirects** are 301 and registered centrally.
- **Image SEO** — descriptive filenames, mandatory alt text, `next/image` with dimensions.

## 8. Content plan (P2)

A blog exists to capture informational intent and build topical authority around fresh food
and daily nutrition. Initial pillars:
- Seasonal produce guides ("what fruit is in season in Bengaluru in September").
- Nutrition explainers tied to our own products.
- Meal-planning and routine content aimed at persona P1.
- Sourcing and freshness transparency — doubles as a trust asset.

Each article links to relevant product and category pages. Articles are authored in the CMS
(P2 `content_blocks`) and rendered via ISR.

## 9. Monitoring

| Tool | Purpose |
|---|---|
| Google Search Console | Coverage, queries, CWV, rich-result validity |
| Bing Webmaster Tools | Secondary |
| Vercel Analytics | Real-user CWV by route |
| Lighthouse CI | Per-PR regression gate on the marketing app |
| Structured-data validation | CI check plus Search Console rich-result reports |

Reviewed monthly: impressions and clicks by query cluster, position changes on money pages,
indexed page count against expected, CWV p75 by route, rich-result errors.

## 10. Business rules

| ID | Rule |
|---|---|
| BR-SEO1 | Only `maindomain.com` is indexable. App and admin send `noindex` at both the app and the edge. |
| BR-SEO2 | Structured data is generated from live API data; prices and availability in rich results always match the API. |
| BR-SEO3 | Product slugs are immutable after publishing; renames create a 301. |
| BR-SEO4 | Filtered and sorted listing URLs are `noindex, follow`. |
| BR-SEO5 | Unpublished products leave the sitemap and return 410 (P2) or 404. |
| BR-SEO6 | Every page has exactly one `<h1>` and a self-referencing canonical. |
| BR-SEO7 | `AggregateRating` is emitted only when real reviews exist. |
