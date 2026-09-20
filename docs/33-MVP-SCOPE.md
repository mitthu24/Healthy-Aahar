# 33 — MVP Scope

## 1. The MVP definition

> A customer in one serviceable zone can discover fresh healthy food, order it for a
> specific delivery slot, pay cash on delivery, track it, and subscribe to receive it
> daily — and one operations person can run the entire fulfilment day from the admin panel.

Anything that does not serve that sentence is not MVP.

## 2. Scope discipline

Three rules that decide every scope argument:

1. **If the business cannot operate without it, it is MVP.** Slot capacity is MVP; coupons
   are not.
2. **If deferring it would require a schema or architecture change later, build the
   structure now and the feature later.** Payments, WhatsApp, multi-zone, batches — the
   tables and interfaces exist; the features do not.
3. **If it is a nice version of something that already works, it is Phase 2.** Search works
   with Postgres full-text; typo-tolerant search with suggestions is Phase 2.

## 3. MVP — in scope

### Customer
- Phone OTP sign-up and sign-in
- Profile and address book with serviceability check
- Browse by category and subcategory; product detail with nutrition, ingredients,
  allergens, preparation and storage
- Product variants
- Keyword search with filters and sort
- Favourites
- Cart with server persistence and guest-cart merge
- Checkout: address, slot selection, COD
- Order confirmation, tracking (polling), history, reorder, cancellation within the window
- Subscriptions: create, view upcoming deliveries, pause, resume, skip, change quantity,
  change slot and address, cancel
- Combos: browse, buy, subscribe
- In-app notification centre
- Transactional email

### Admin
- Sign-in with RBAC (7 roles)
- Operations dashboard with the exception list
- Orders: list, filter, detail, status transitions, bulk status, cancel, internal notes
- Prep list and dispatch manifest
- Subscriptions: list, detail, intervene, plans, exceptions
- Catalogue: categories, products, variants, images, combos
- Inventory: stock, adjustments, movements, low-stock
- Delivery: zones, pincodes, slots, capacity, holidays
- Customers: list, detail, notes, suspend
- Admin users, roles, audit log, settings
- Reports: sales, products, subscriptions, customers, inventory, slot utilisation, COD

### Marketing
- Homepage with pincode checker
- Product, category, combo and subscription pages from the live API
- How it works, freshness, about, delivery areas, FAQ, contact
- Legal pages
- SEO: metadata, structured data, sitemap, robots

### Platform
- API on Railway with OpenAPI; PostgreSQL; two Firebase projects; Brevo; R2 + CDN;
  Cloudflare; worker with the five scheduled jobs; outbox; audit logs; Sentry; CI/CD;
  backups with a tested restore

## 4. MVP — explicitly out of scope

| Excluded | Why | Phase |
|---|---|---|
| Online payments | Gateway onboarding is slow; COD is sufficient to launch and the abstraction is built | 4 |
| Coupons and promotions | Schema exists; not needed to acquire the first 100 customers | 2 |
| Reviews and ratings | Needs customers first | 2 |
| WhatsApp | Real integration cost; email covers transactional needs | 5 |
| Push notifications | Requires a PWA/native surface | 3 |
| Multi-zone operations | One zone at launch; schema supports more | 3 |
| Delivery-partner app and live tracking | Manual delivery at launch | Future |
| Inventory batches and expiry | Needs real wastage data to design against | 2 |
| Advanced search (typo tolerance, suggestions) | Postgres FTS is adequate for 200 SKUs | 2 |
| CMS for banners and blog | Static content is fine at launch | 2 |
| Loyalty, referrals, wallets | Retention comes from subscriptions first | Future |
| Native mobile apps | API is ready; apps need the web product validated first | 6 |
| Real-time push of order status | Polling satisfies the requirement | 3 |
| Customer-configurable combos | Fixed combos prove the concept | 3 |
| Prepaid subscription billing | Requires a gateway | 4 |
| Dark mode | Food photography is shot for light backgrounds | Future |
| Multi-language | Single market, `en-IN` | Future |
| GST invoicing | Pending a business decision (Q5) | 2 |

## 5. Feature classification

| Feature | MVP | P2 | P3 | P4 | P5 | P6 |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| Phone OTP auth | ● | | | | | |
| Email/password auth | | ● | | | | |
| Catalogue with variants | ● | | | | | |
| Nutrition and allergens | ● | | | | | |
| Search (FTS + fuzzy) | ● | | | | | |
| Search suggestions, typo tolerance | | ● | | | | |
| Personalised recommendations | | | ● | | | |
| Cart and checkout | ● | | | | | |
| COD | ● | | | | | |
| Online payment | | | | ● | | |
| Prepaid subscription billing | | | | ● | | |
| Order lifecycle and tracking | ● | | | | | |
| Partial fulfilment and refunds | | ● | | | | |
| Live map tracking | | | | | | ○ |
| Delivery slots and capacity | ● | | | | | |
| Reserved subscription capacity | | ● | | | | |
| Geo-polygon zones | | | ● | | | |
| Subscriptions (full lifecycle) | ● | | | | | |
| Editable day patterns mid-cycle | | ● | | | | |
| Combos | ● | | | | | |
| Configurable combos | | | ● | | | |
| Inventory | ● | | | | | |
| Batches, expiry, wastage costing | | ● | | | | |
| Demand forecasting | | ● | | | | |
| In-app notifications | ● | | | | | |
| Transactional email | ● | | | | | |
| Notification preferences | | ● | | | | |
| Push notifications | | | ● | | | |
| WhatsApp | | | | | ● | |
| SMS | | | | | | ○ |
| RBAC (7 roles) | ● | | | | | |
| ANALYST role | | ● | | | | |
| DELIVERY_MANAGER role | | | ● | | | |
| Per-zone admin scoping | | | ● | | | |
| Audit logs | ● | | | | | |
| Reports | ● | | | | | |
| Rollup tables and cohort analysis | | ● | | | | |
| Coupons | | ● | | | | |
| Reviews | | ● | | | | |
| CMS and blog | | ● | | | | |
| SEO foundations | ● | | | | | |
| Locality landing pages | | ● | | | | |
| Multi-zone operations | | | ● | | | |
| Multi-business | | | | | | ○ |
| Native apps | | | | | | ● |

● planned · ○ future/unscheduled

## 6. Legal and policy pages (MVP, content supplied by the business)

Terms & Conditions · Privacy Policy · Refund Policy · Cancellation Policy ·
Shipping/Delivery Policy · Subscription Terms · Cookie Policy (only if non-essential
cookies are used) · Contact and grievance officer details.

We specify the pages, their routes and their placement; **we do not write the legal text**.
Subscription Terms must at minimum state: billing basis, pause/skip/cancel rules and their
limits, notice periods, the price-change process (BR-S7), and what happens on a failed
delivery.

## 7. Definition of done for the MVP

- [ ] Every MVP feature above is implemented and deployed to production
- [ ] All critical test scenarios (doc 24 §3) pass
- [ ] All concurrency tests (doc 24 §5) pass
- [ ] All 12 E2E journeys pass
- [ ] Performance budgets met on marketing and customer apps
- [ ] Security checklist complete (doc 23 §15)
- [ ] Role × endpoint authorization matrix fully covered
- [ ] Backup restore tested successfully at least once
- [ ] Rollback rehearsed at least once
- [ ] Monitoring and alerts live, including the dead-man's switches
- [ ] Admin can complete a full operational day without engineering help
- [ ] A real order placed end to end with a real delivery and a real email
- [ ] Legal pages published
- [ ] Seed data loaded for the launch zone

## 8. Honest risks to the MVP

| Risk | Impact | Mitigation |
|---|---|---|
| Subscription engine complexity | The largest source of estimation error | Built early (PHASE 09), tested hardest, invariants in the database |
| Slot capacity concurrency | Over-booking is an operational disaster | `CHECK` constraint + row lock + explicit load test |
| Catalogue content readiness | Nothing to sell without photography and nutrition data | Content collection runs in parallel from Phase 1 |
| Scope creep from "small" admin requests | Slips the launch | This document; every addition needs an explicit scope decision |
| Firebase OTP cost and delivery | Sign-up friction | Monitor cost per sign-up; email fallback is P2 |
| Single-region single-instance API | An outage is total | Documented DR (doc 29); stateless service scales horizontally when needed |
