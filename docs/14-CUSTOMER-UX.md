# 14 — Customer Experience

`app.maindomain.com` — mobile-first, authenticated, conversion-focused.

## 1. Principles

1. **Mobile is the product.** Design at 375px first; desktop is a widened mobile layout, not
   a different design. Every primary action sits within thumb reach in the bottom third.
2. **Fewest taps to a repeat order.** The best customer opens the app, taps "Buy again",
   taps "Place order". Two taps. Everything else serves that path.
3. **Never block on information we can infer.** Default address, default slot, default
   variant — all preselected, all changeable.
4. **Explain, never fail silently.** A full slot says "Fully booked — next available:
   tomorrow morning". An out-of-stock item says which component is missing.
5. **Food first.** Photography is the interface. Chrome is quiet; product imagery is loud.
6. **Speed is a feature.** Perceived load under 1s; skeletons, not spinners; optimistic cart.
7. **Honest scarcity only.** "3 slots left" appears when three slots are actually left.

## 2. Information architecture

```
Bottom navigation (5 items, always visible)
├── Home         merchandising, reorder, rails
├── Categories   full catalogue browse
├── Subscriptions your standing deliveries       ← elevated deliberately
├── Orders       history and tracking
└── Profile      account, addresses, favourites, support

Cart: a persistent floating bar above the nav when non-empty
Search: a pinned field at the top of Home and Categories
```

**Why Subscriptions occupies a bottom-nav slot** rather than hiding in Profile: it is the
business's retention engine and the persona P1's only reason to open the app. Burying it
makes pausing hard, and a customer who cannot pause cancels.

## 3. Screens

### 3.1 Home
The merchandising surface. Order of blocks, top to bottom:

1. **Header** — delivery address chip (tap to switch), notification bell.
2. **Search** — "Search fruits, salads, sprouts…".
3. **Next delivery card** — *only when one exists*: "Tomorrow, 6–8 AM · Fruit Chaat Bowl ·
   Skip / Manage". This is the single most valuable component on the screen for P1.
4. **Category rail** — horizontal, circular images.
5. **Buy again** — last ordered items, one-tap add. Only for returning customers.
6. **Subscription promo** — "Save 15% with a daily plan" (hidden if already subscribed).
7. **Featured combos**.
8. **Bestsellers**.
9. **New arrivals**.
10. **Trust strip** — sourcing, freshness, hygiene.

Data: one `/v1/public/products` call per rail (parallel, cached) plus `/v1/me/orders?limit=1`
and `/v1/me/deliveries/upcoming?limit=1`. Rails stream in; the page never blocks on the
slowest one.

### 3.2 Categories and listing
Two-level: category grid → subcategory tabs → product grid (2 columns at 375px).
Sticky filter and sort bar. Filters open in a bottom sheet: dietary tags, price range,
subscribable only, in stock only. Applied filters render as removable chips.
Infinite scroll with cursor pagination; a "back to top" button appears after two screens.

### 3.3 Product detail
```
[ image gallery, swipeable, 1:1 ]
  Product name                    [♡]
  ₹149  ₹179  17% off
  ★ 4.6 (128)                          ← P2
  [ 250g ] [ 500g ]                    ← variant chips, default preselected
  Short description
  ─────────────────────────────────
  ▸ Nutrition (per 150g)               ← expanded by default; this is why
  ▸ Ingredients                          people buy from us
  ▸ Preparation & freshness
  ▸ Storage & shelf life
  ▸ Allergens                          ← always visible if any exist
  ─────────────────────────────────
  Subscribe & save 15% →               ← if is_subscribable
  Similar products
  ─────────────────────────────────
[ sticky bottom bar:  − 1 +   Add to cart · ₹149 ]
```
Out of stock replaces the bar with "Notify me" (P2) and shows the next expected availability
if known. The sticky bar is the only fixed element; everything else scrolls.

### 3.4 Cart
Line items with thumbnail, name, variant, stepper, line total. Combos show their components
collapsed under the parent. The summary shows subtotal, delivery fee, discount and total,
with a progress bar to free delivery or minimum order when relevant.

`issues[]` from the API renders as inline banners — blocking issues in red at the top,
warnings in amber against the line. "Proceed to checkout" is disabled while any blocking
issue exists, with the reason stated on the button itself rather than in a tooltip.

### 3.5 Checkout
One page, three collapsible sections, progressive disclosure:

```
1  Delivery address     [default preselected]           Change
2  Delivery slot        [next available preselected]    Change
3  Payment              Cash on Delivery                (only option at MVP)
   ─────────────────────────────────────────
   Order summary
   [ Place order · ₹327 ]
```

- Address sheet: saved addresses with serviceability badges, plus "Add new".
- Slot sheet: horizontal date strip (7 days), slot cards per date showing window, fee,
  remaining capacity and, when unavailable, the reason. Unavailable slots are shown greyed
  with their reason, never hidden (doc 10 §5).
- Payment section exists at MVP with a single option, so adding online payment later changes
  a list rather than introducing a new step.
- The primary button carries the exact amount. `expected_total_paise` is sent with the
  request; a `PRICE_CHANGED` response opens a sheet showing old and new totals and requires
  explicit re-confirmation.

Checkout is **one page** because every additional step loses customers, and there is nothing
here that genuinely needs sequencing.

### 3.6 Order confirmation
Success animation, order number, delivery date and window in plain language ("Tomorrow
between 6:00 and 8:00 AM"), address, items, total, and two CTAs: "Track order" and
"Subscribe to this and save 15%" — the highest-intent moment for a subscription pitch.

### 3.7 Order tracking
Vertical stepper: Placed → Confirmed → Preparing → Packed → Out for delivery → Delivered,
with timestamps. Polls `/v1/me/orders/:id/track` every 30s while the tab is visible; stops
when hidden or terminal (ADR-016). "Cancel order" appears with a live countdown to the
cancellation deadline while cancellation is permitted.

### 3.8 Orders
List with status pill, date, item thumbnails, total. Filter by status. Each row offers
"Reorder" (clones into the cart) and "Track" for live orders.

### 3.9 Subscriptions

**List** — cards showing plan name, items, schedule ("Mon–Fri, 6–8 AM"), next delivery,
status pill, price per delivery.

**Detail** — the screen P1 lives in:
```
Daily Fruit Chaat            [ACTIVE]
₹129 per delivery · save ₹20
Mon – Fri · Morning 6–8 AM
Home · 402, Green Meadows

Upcoming deliveries
  Tue 22 Sep   Scheduled    [Skip]
  Wed 23 Sep   Scheduled    [Skip]
  Thu 24 Sep   Order placed  HL-2026-0001861 →
  Fri 25 Sep   Skipped      [Undo]

[ Pause ]  [ Manage ]  [ Cancel ]
Skips used this month: 1 of 8
```
Every action's availability comes from the API's `rules` block (doc 06 §9), so the UI never
hard-codes policy and always matches what the server will allow.

**Pause sheet** — date range picker, with a clear statement of consequences and an explicit
list of already-placed orders that will **not** be cancelled, each with its own cancel link
(EC-S1).

**Subscribe flow** — from a product or plan: quantity → days (chips, plan-constrained) →
slot → address → start date → review with price and savings → confirm. Four taps for the
default path, because every extra decision loses a subscriber.

### 3.10 Profile
Name, phone (verified badge), email. Sections: Addresses, Favourites, Notifications,
Notification preferences (P2), Help & support, Legal, Sign out.

### 3.11 Supporting screens
Search (recent searches, suggestions, results with an empty state that suggests categories),
Address add/edit (with live serviceability check), Favourites, Notification centre, Help
(FAQ + WhatsApp/phone contact), and the legal pages listed in doc 16 §8.

## 4. Key flows

**First order (cold start)**
`Landing → phone → OTP → name → home → product → add to cart → cart → checkout
 (address: new → slot: default → COD) → placed`
Target: **under 90 seconds**. Measured in E2E tests as a performance assertion, not a vibe.

**Repeat order** — `Home → Buy again → Place order`. Two taps.

**Subscribe** — `Product → Subscribe & save → days/slot/start → confirm`. Under 60 seconds.

**Pause while travelling** — `Subscriptions → card → Pause → date range → confirm`. Four taps.

## 5. Empty, loading and error states

Every list has a designed empty state with an action: empty cart → "Browse bestsellers";
no orders → "Start with a bestseller"; no subscriptions → "Save 15% with a daily plan";
no search results → "No results for 'aple' — did you mean 'apple'?" plus category shortcuts.

Loading uses skeletons matching the final layout (no layout shift, no spinners on content).
Cart mutations are optimistic with rollback on failure.

Errors are mapped from API `code` to human copy in one place,
`apps/customer/src/lib/error-messages.ts`. Network failure shows an inline retry, never a
blank screen. A `500` shows "Something went wrong" plus the `request_id` for support.

## 6. Accessibility (WCAG 2.2 AA)

Minimum 44×44px touch targets; 4.5:1 text contrast (brand green is darkened for text use —
doc 17 §3); visible focus rings; semantic headings; labelled form fields with inline errors
announced via `aria-live`; alt text mandatory on product images (enforced by API validation);
`prefers-reduced-motion` honoured; full keyboard navigation; no colour-only status (icons and
text accompany every status pill).

## 7. Performance budget

| Metric | Target |
|---|---|
| LCP (Home, 4G mid-tier Android) | ≤ 2.0s p75 |
| INP | ≤ 200ms |
| CLS | ≤ 0.1 |
| First-load JS (Home) | ≤ 160KB gzipped |
| Add-to-cart perceived latency | ≤ 100ms (optimistic) |
| Category navigation | ≤ 300ms (prefetched) |

Tactics in [22-PERFORMANCE-STRATEGY.md](22-PERFORMANCE-STRATEGY.md).

## 8. PWA

Installable (manifest, icons, splash), app-shell cached, offline fallback for catalogue
browsing, no offline ordering (stock and slots must be live). Web push is P3 and shares the
device-registration endpoint the native apps will use.

## 9. Privacy

`app.maindomain.com` sends `X-Robots-Tag: noindex, nofollow` on every response and ships a
`robots.txt` disallowing everything. Nothing behind authentication is indexable, and no order
or address data ever appears in a URL, a query string or an analytics event (doc 23 §11).
