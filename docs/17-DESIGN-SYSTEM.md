# 17 — Design System

## 1. Brand direction

**Positioning in one line:** *fresh, premium, effortless.*

Not a discount grocer (loud yellow, urgency badges, crowded grids) and not a clinical health
app (sterile white, charts, numbers). The reference point is a very good neighbourhood fruit
shop: generous daylight, real produce, calm surfaces, nothing shouting.

| We are | We are not |
|---|---|
| Fresh, natural, daylight | Neon, dark mode as default, synthetic |
| Premium but unpretentious | Luxury, exclusive, expensive-feeling |
| Calm and confident | Urgent, countdown timers, fake scarcity |
| Food-forward | Illustration-forward, mascot-driven |
| Warm | Corporate, clinical |

**Deliberate differences from Blinkit/Zepto:** no purple/yellow speed-first palette, no
countdown pressure, no dense 4-column grids, no "10 minutes" as the headline promise. Our
hero is the food and the reliability of the slot.

> Brand name and wordmark are pending (Q1). Tokens below are final and name-independent.

## 2. Colour

Built around a deep leaf green with a warm citrus accent. Green signals fresh and natural
without being the literal supermarket green; the citrus accent carries energy and is used
sparingly for emphasis.

### Brand scale — `green`
| Token | Hex | Use |
|---|---|---|
| `green-50` | `#F1F8F3` | Tinted section backgrounds |
| `green-100` | `#DDEEE2` | Subtle fills, chips |
| `green-200` | `#BCDCC6` | Borders on tinted surfaces |
| `green-300` | `#8FC4A1` | Decorative |
| `green-400` | `#5EA57B` | Hover on light |
| `green-500` | `#2E8B57` | **Primary brand** — logo, illustration |
| `green-600` | `#256F46` | **Primary action** — buttons, links (AA on white) |
| `green-700` | `#1C5536` | Hover/pressed |
| `green-800` | `#143C26` | Headings on light |
| `green-900` | `#0C2417` | Maximum contrast |

### Accent — `citrus`
| Token | Hex | Use |
|---|---|---|
| `citrus-100` | `#FFF1D6` | Badge background |
| `citrus-400` | `#FFB020` | Badges, ratings, highlight |
| `citrus-500` | `#F59300` | Accent action (used sparingly) |
| `citrus-700` | `#A35F00` | **Accent text** — AA on white |

**Rule:** `citrus-400` is decorative only. Any citrus used as text or as a small icon on
white must be `citrus-700`. This is the most common contrast failure in warm palettes, so it
is a lint rule, not a guideline.

### Neutrals — `sand`
Warm-tinted greys, not pure grey, so photography sits on a surface that feels like paper
rather than a screenshot.

| Token | Hex | Use |
|---|---|---|
| `sand-0` | `#FFFFFF` | Cards, surfaces |
| `sand-50` | `#FAF9F7` | **Page background** |
| `sand-100` | `#F2F0EC` | Alternate sections |
| `sand-200` | `#E6E3DD` | Borders, dividers |
| `sand-400` | `#A8A29A` | Disabled, placeholder |
| `sand-600` | `#6B6760` | **Secondary text** (AA) |
| `sand-800` | `#33302B` | **Body text** |
| `sand-900` | `#1A1815` | Headings |

### Semantic
| Token | Hex | Use |
|---|---|---|
| `success-600` | `#1E7F4C` | Delivered, in stock, confirmed |
| `warning-600` | `#B45309` | Low stock, nearly full, pending |
| `danger-600` | `#C0392B` | Cancelled, failed, destructive |
| `info-600` | `#2563A5` | Neutral information |

Each has `-50` and `-100` background variants. Status is **never colour-only**: every status
pill carries an icon and a word (doc 14 §6).

### Order status colours
`PENDING` info · `CONFIRMED` info · `PREPARING` warning · `READY_FOR_DISPATCH` warning ·
`OUT_FOR_DELIVERY` green-600 · `DELIVERED` success · `CANCELLED` sand-600 ·
`FAILED`/`RETURNED` danger.

### Contrast commitments
`green-600` on `sand-0` = 5.4:1 ✅ · `sand-800` on `sand-50` = 12.1:1 ✅ ·
`sand-600` on `sand-0` = 5.1:1 ✅ · `citrus-700` on `sand-0` = 4.8:1 ✅ ·
white on `green-600` = 5.4:1 ✅. Verified in CI with an automated contrast check over the
token file.

### Dark mode
**Not shipped at MVP.** Food photography is shot on light backgrounds and looks wrong on
dark; a half-committed dark mode is worse than none. Tokens are defined as CSS custom
properties on `:root` so a dark theme is a token override later, not a refactor.

## 3. Typography

| Role | Family | Rationale |
|---|---|---|
| Display / headings | **Fraunces** (variable, optical sizing) | Warm, slightly editorial serif — signals "good food", not "software" |
| Body / UI | **Inter** (variable) | Excellent small-size legibility, wide language coverage, superb numerals |
| Numerals | Inter with `font-variant-numeric: tabular-nums` | Prices and quantities must not jitter when they change |

Self-hosted via `next/font` — no external request, no layout shift, no third-party dependency
on the critical path.

### Scale (1.250 major third, 16px base)
| Token | Size / line-height | Use |
|---|---|---|
| `display-lg` | 48 / 56 | Marketing hero |
| `display-sm` | 36 / 44 | Section headings |
| `heading-lg` | 28 / 36 | Page titles |
| `heading-md` | 22 / 30 | Card titles, product names |
| `heading-sm` | 18 / 26 | Subsections |
| `body-lg` | 17 / 26 | Product descriptions |
| `body-md` | 15 / 22 | **Default UI text** |
| `body-sm` | 13 / 20 | Secondary, metadata |
| `caption` | 12 / 16 | Labels, badges |

Minimum body size on mobile is 15px. 13px is permitted only for genuinely secondary
metadata, never for an action or a price.

## 4. Space, radius, elevation

**Spacing** — 4px base: `1`=4, `2`=8, `3`=12, `4`=16, `5`=20, `6`=24, `8`=32, `10`=40,
`12`=48, `16`=64, `20`=80. Page gutter is 16px on mobile, 24px on tablet, 32px on desktop.

**Radius** — `sm` 6 (chips, inputs) · `md` 10 (buttons) · `lg` 16 (**cards — the signature
shape**) · `xl` 24 (sheets, modals) · `full` (avatars, pills).
Generous, consistent rounding is a large part of the "fresh and friendly" read.

**Elevation** — soft, warm-tinted, never grey-black:
`sm` `0 1px 2px rgba(26,24,21,.06)` · `md` `0 4px 12px rgba(26,24,21,.08)` ·
`lg` `0 12px 28px rgba(26,24,21,.10)` · `sheet` `0 -8px 32px rgba(26,24,21,.14)`.
Cards use `sm` at rest and `md` on hover. Elevation communicates layering only — never
decoration.

## 5. Components (`packages/ui`)

Built on Radix primitives for behaviour and accessibility; all visuals are ours.

**Primitives** — Button (primary/secondary/ghost/danger × sm/md/lg, loading, icon-only ≥44px),
IconButton, Input, Textarea, Select, Checkbox, Radio, Switch, Stepper (`− 1 +`), Slider,
Badge, Pill, Avatar, Skeleton, Spinner, Divider, Tooltip.

**Layout** — Container, Stack, Grid, Card, Section, BottomSheet, Modal, Drawer, Tabs,
Accordion, Breadcrumb.

**Feedback** — Toast, Alert (info/success/warning/danger), EmptyState (illustration +
message + action), ErrorState (with retry), ConfirmDialog (typed consequences).

**Commerce** — ProductCard, ProductCardSkeleton, PriceDisplay (price, MRP struck through,
discount badge), VariantSelector, QuantityStepper, AddToCartButton (idle/adding/added),
CartLineItem, CartSummary, SlotPicker, SlotCard, AddressCard, OrderStatusTimeline,
SubscriptionCard, DeliveryScheduleList, NutritionTable, DietaryTagList, ComboComponentList.

**Admin** — DataTable (sort, filter, cursor pagination, bulk select), FilterBar, StatCard,
StatusPill, AuditDiff, PermissionGate, DateRangePicker, BulkActionBar.

### Button specification
| Variant | Background | Text | Use |
|---|---|---|---|
| Primary | `green-600` | white | The one main action per screen |
| Secondary | `sand-0`, `sand-200` border | `sand-800` | Alternatives |
| Ghost | transparent | `green-600` | Tertiary, in-card |
| Danger | `danger-600` | white | Destructive only |

Heights 36/44/52 (sm/md/lg); mobile primary actions use `lg`. Every button has explicit
hover, active, focus-visible, disabled and loading states. **Focus-visible is a 2px
`green-600` ring with a 2px offset and is never removed** — an unstyled focus ring is a bug.

## 6. Motion

| Token | Duration / easing | Use |
|---|---|---|
| `instant` | 100ms ease-out | Hover, focus |
| `quick` | 180ms ease-out | Buttons, chips, toggles |
| `base` | 260ms cubic-bezier(.2,.8,.2,1) | Cards, accordions, tabs |
| `slow` | 380ms same | Sheets, modals, page transitions |

Signature interactions: add-to-cart fly-to-cart with a subtle count bounce; slot selection
scale-and-fill; order status advancing with a drawn connector; skeleton shimmer at 1.4s.

`prefers-reduced-motion: reduce` disables transforms and shimmer, keeping opacity fades only.
This is enforced globally in the base stylesheet, so no component can opt out by accident.

## 7. Imagery

- Product photography is 1:1, top-down or 45°, on a light warm surface, natural daylight.
- Raw ingredients visible; never over-styled or artificially glossy.
- Delivered in AVIF/WebP at 1200×1200 originals; the CDN generates 400/800/1200 variants.
- Every image has a blur placeholder (LQIP) and explicit dimensions — CLS budget is 0.05 on
  marketing, so an image without dimensions is a build failure.
- Alt text is mandatory and is validated by the API on upload (doc 04 §5.4).

## 8. Iconography

Lucide, 1.5px stroke, 20px default (24px for navigation). Consistent stroke weight matters
more than icon choice. Custom icons only for domain concepts that Lucide lacks — slot window,
subscription cycle, freshness — drawn to match the same stroke and corner radius.

## 9. Voice

Warm, direct, never salesy. Short sentences. Indian-English conventions (₹, lakh, pincode).

| Do | Don't |
|---|---|
| "Delivered tomorrow, 6–8 AM" | "Lightning-fast delivery!" |
| "Fully booked — try Evening" | "Slot unavailable" |
| "Saved ₹20 with your plan" | "MEGA SAVINGS!!!" |
| "Pause any time" | "Cancel anytime — no strings attached!" |
| "We don't deliver to 560099 yet" | "Service unavailable" |

Errors follow one shape: **what happened → why → what to do now.**
*"We couldn't place your order — the 6–8 AM slot filled up while you were checking out.
Pick another slot to continue."*

## 10. Tokens as code

```
packages/config/tokens/
├── colors.json        ← single source of truth
├── typography.json
├── spacing.json
├── radius.json
├── elevation.json
└── motion.json
```
A build step generates the Tailwind preset and a CSS custom-property sheet. Tokens are
consumed as CSS variables (`--color-green-600`), which keeps them usable from Tailwind, raw
CSS, and — later — React Native via the same JSON. No component hard-codes a hex value; a
literal colour in a component fails lint.

## 11. Responsive

| Breakpoint | Width | Layout |
|---|---|---|
| base | 0–639 | 1 column, bottom nav, sheets |
| `sm` | 640 | 2-column product grid |
| `md` | 768 | Tablet; admin becomes usable |
| `lg` | 1024 | 3–4 column grids, sidebar nav |
| `xl` | 1280 | Max content width 1200px |

Customer and marketing are designed mobile-first. Admin is designed desktop-first at 1440px
and degrades gracefully to 768px.
