# 16 — Marketing Website

`maindomain.com` — the public, indexable, conversion-focused front door.

## 1. Job to be done

Turn a stranger into a first order or a subscription. It is not a brochure and not a second
storefront. Its single measurable job is **click-through to `app.maindomain.com` with
intent**, plus organic acquisition through search.

Three audiences:
1. **Search visitors** — "fresh cut fruit delivery HSR layout". Need: do you deliver to me,
   what does it cost, is it fresh.
2. **Referred visitors** — need social proof and a reason to trust food from strangers.
3. **Returning visitors** — need the fastest possible path to sign in.

## 2. Why it is a separate app

`apps/marketing` is a separate Next.js app from `apps/customer` (ADR-003) because the two
have opposite requirements: fully static and indexed versus fully dynamic and `noindex`;
a tiny bundle for first-visit LCP versus a rich authenticated application; deploys driven by
content versus deploys driven by product. They share `packages/ui`, `packages/contracts` and
`packages/sdk`, so the brand and the data contracts stay identical.

## 3. Pages

| Route | Rendering | Purpose |
|---|---|---|
| `/` | ISR 300s | Homepage |
| `/products` | ISR 300s | Catalogue browse |
| `/products/[slug]` | ISR 300s + `generateStaticParams` | Product page — the main SEO asset |
| `/categories` | ISR 300s | Category index |
| `/categories/[slug]` | ISR 300s | Category landing |
| `/combos` , `/combos/[slug]` | ISR 300s | Combos |
| `/subscriptions` | ISR 300s | Subscription proposition |
| `/subscriptions/[slug]` | ISR 300s | Plan detail |
| `/how-it-works` | Static | Order → prepare → deliver |
| `/freshness` | Static | Sourcing, hygiene, cold chain — the trust page |
| `/about` | Static | Story and team |
| `/delivery-areas` | ISR 3600s | Serviceable pincodes and slot windows |
| `/faq` | ISR 3600s | Accordion, `FAQPage` schema |
| `/contact` | Static | Form → Brevo, plus WhatsApp and phone |
| `/blog`, `/blog/[slug]` | ISR (P2) | SEO content engine |
| `/terms`, `/privacy`, `/refund-policy`, `/cancellation-policy`, `/delivery-policy`, `/subscription-terms`, `/cookie-policy` | Static | Legal (doc 33 §6) |
| `/sitemap.xml`, `/robots.txt` | Dynamic | SEO |

## 4. Homepage structure

1. **Hero** — one sentence of value, a pincode checker, and a primary CTA.
   The pincode checker is the hero element, not a footer afterthought: for a delivery
   business the visitor's first question is "do you come to me?", and answering it
   immediately is the highest-leverage conversion decision on the site.
2. **How it works** — three steps, illustrated.
3. **Category rail** — live from the API.
4. **Bestsellers** — live products with prices; every card links to `/products/[slug]`.
5. **Subscription proposition** — savings, flexibility (pause, skip, cancel anytime), a plan
   comparison, CTA to sign up.
6. **Featured combos** — live.
7. **Freshness and trust** — sourcing, same-day prep, hygiene, no preservatives.
8. **Testimonials** — P2, real reviews only.
9. **Delivery slots** — "Morning 6–8 AM, Evening 5–7 PM" rendered **from the API**, so
   changing a slot in admin changes the website (BR-MK2).
10. **FAQ preview** — five questions with `FAQPage` schema.
11. **Final CTA** — pincode checker again, plus app sign-up.
12. **Footer** — links, legal, contact, social.

## 5. Data flow — one source, no duplication

```
admin publishes a product
        │
        ▼
  PostgreSQL  ──►  api.maindomain.com  ──►  /v1/public/products
                                              │           │
                                     apps/marketing   apps/customer
                                       (ISR 300s)      (live fetch)
```

The marketing site holds **no catalogue copy of its own** — no CMS duplicate, no hard-coded
price lists, no static JSON of products. Everything commercial comes from the same public
API the app uses. Only narrative content (about, how-it-works, freshness) lives as static
content in the repo, because it is genuinely editorial and changes with design, not with
inventory.

**Freshness of the ISR cache:** 300s by default, plus an on-demand revalidation webhook fired
by the API when a product, combo or plan is published or unpublished. Ordinary edits appear
within five minutes; publishing appears immediately. A stale price on a public page is a
trust problem, so the revalidation hook is not optional (BR-MK1).

**Failure behaviour:** if the API is unavailable at build or revalidation time, the last good
static page is served. The marketing site must never 500 because the backend hiccupped — it
is the top of the funnel and often a first impression.

## 6. Conversion mechanics

| Element | Behaviour |
|---|---|
| Pincode checker | `GET /v1/public/serviceability`. Serviceable → "We deliver to HSR Layout" + CTA. Not serviceable → waitlist email capture (a real demand signal for expansion) |
| Product card CTA | Deep-links to `app.maindomain.com/products/[slug]?ref=marketing` so the item is ready in the app |
| Subscription CTA | Deep-links to the subscribe flow for that plan |
| Sticky mobile CTA | Appears after 50% scroll |
| Exit intent | Not used — it is hostile on mobile and ineffective |

Cross-domain handoff passes only `ref` and the target slug in the URL. **No PII, no cart
contents, no tokens ever cross in a query string** (doc 23 §11).

## 7. SEO

Full strategy in [21-SEO-STRATEGY.md](21-SEO-STRATEGY.md). Marketing-specific points:
- Product pages carry `Product` + `Offer` structured data with live price and availability
  from the API, so rich results never advertise a price we do not charge.
- `LocalBusiness` schema with service area.
- `BreadcrumbList` on category and product pages.
- `FAQPage` on `/faq` and the homepage FAQ block.
- Canonical URLs on every page; `/products/[slug]` is canonical for a product, and the
  customer app's equivalent page is `noindex` so the two never compete.
- `sitemap.xml` generated from live active products, combos, plans and categories.

## 8. Performance

Marketing is the strictest performance surface because it is judged by cold visitors on
mobile networks and by Core Web Vitals.

| Metric | Target |
|---|---|
| LCP | ≤ 1.8s p75 mobile |
| INP | ≤ 200ms |
| CLS | ≤ 0.05 |
| First-load JS | ≤ 100KB gzipped |
| Lighthouse (mobile) | ≥ 95 performance, 100 accessibility, 100 SEO |

Tactics: server components by default with almost no client JS; `next/image` with AVIF/WebP
and explicit dimensions; hero image preloaded; fonts self-hosted with `font-display: swap`
and preload; no third-party scripts above the fold; analytics deferred; Cloudflare edge
caching of HTML.

## 9. Analytics and consent

Minimal and privacy-respecting: Vercel Analytics for Web Vitals, plus one lightweight product
analytics tool (P2) for funnel measurement. No Google Analytics at launch, no advertising
pixels until there is advertising to attribute.

A cookie consent banner appears only if a non-essential cookie is actually set. Defaulting to
"decline non-essential" is the standing policy. A consent banner for cookies we do not use is
a self-inflicted conversion penalty.

## 10. Business rules

| ID | Rule |
|---|---|
| BR-MK1 | The marketing site shows only `ACTIVE` catalogue entities, fetched from the API. Publishing triggers on-demand revalidation. |
| BR-MK2 | Delivery slot windows shown publicly are read from the API, never hard-coded in content. |
| BR-MK3 | Prices shown publicly equal the API price at revalidation time; the page states nothing the API does not say. |
| BR-MK4 | The marketing site never writes business data. Its only write is a contact-form or waitlist submission, which goes to Brevo, not to our core tables. |
| BR-MK5 | No authenticated content is rendered on `maindomain.com`. Sign-in lives entirely on `app.maindomain.com`. |
| BR-MK6 | The marketing site degrades to cached content when the API is unavailable; it never shows an error page for a catalogue outage. |
