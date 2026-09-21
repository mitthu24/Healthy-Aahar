# Healthly — Documentation Index

> **Working codename:** `healthly`. Final brand name and domain are TBD.
> Throughout these docs the placeholder domain is `maindomain.com`.

This `/docs` directory is the **single source of truth** for the product, architecture,
database, APIs, security model, and delivery plan. Code must follow these documents.
Where code and docs disagree, either the code is a bug or the doc must be amended via
a PR that updates [36-DECISIONS-LOG.md](36-DECISIONS-LOG.md).

## Status

| | |
|---|---|
| Phase | **PHASE 02 — Database & API Foundation** |
| State | Complete, awaiting approval |
| Next | PHASE 03 — Authentication & RBAC (blocked on approval) |
| Reports | [PHASE-01](PHASE-01-IMPLEMENTATION-REPORT.md) · [PHASE-02](PHASE-02-IMPLEMENTATION-REPORT.md) |

## Reading order

**Start here (everyone):** 01 → 33 → 02 → 34

### Product
| # | Document | Purpose |
|---|---|---|
| 01 | [PRODUCT-REQUIREMENTS-DOCUMENT](01-PRODUCT-REQUIREMENTS-DOCUMENT.md) | What we are building and for whom |
| 31 | [BUSINESS-RULES](31-BUSINESS-RULES.md) | Every rule the system enforces, numbered `BR-*` |
| 32 | [EDGE-CASES](32-EDGE-CASES.md) | What happens when reality misbehaves |
| 33 | [MVP-SCOPE](33-MVP-SCOPE.md) | MVP / Phase 2 / Phase 3 / Future classification |
| 34 | [PHASED-ROADMAP](34-PHASED-ROADMAP.md) | Phase-by-phase delivery plan |
| 35 | [IMPLEMENTATION-CHECKLIST](35-IMPLEMENTATION-CHECKLIST.md) | Tickable execution checklist |

### Architecture
| # | Document | Purpose |
|---|---|---|
| 02 | [SYSTEM-ARCHITECTURE](02-SYSTEM-ARCHITECTURE.md) | Services, boundaries, runtime topology |
| 03 | [TECH-STACK](03-TECH-STACK.md) | Chosen technologies and why |
| 30 | [API-MOBILE-APP-READINESS](30-API-MOBILE-APP-READINESS.md) | How native apps reuse this backend |
| 36 | [DECISIONS-LOG](36-DECISIONS-LOG.md) | ADRs — every binding decision |

### Data & API
| # | Document | Purpose |
|---|---|---|
| 04 | [DATABASE-DESIGN](04-DATABASE-DESIGN.md) | Full table-by-table schema spec |
| 05 | [DATABASE-ERD](05-DATABASE-ERD.md) | Entity relationship diagrams |
| 06 | [API-SPECIFICATION](06-API-SPECIFICATION.md) | Complete endpoint contracts |

### Domain engines
| # | Document | Purpose |
|---|---|---|
| 09 | [ORDER-LIFECYCLE](09-ORDER-LIFECYCLE.md) | Order state machine |
| 10 | [DELIVERY-SLOT-SYSTEM](10-DELIVERY-SLOT-SYSTEM.md) | Slots, capacity, cutoffs, zones |
| 11 | [SUBSCRIPTION-ENGINE](11-SUBSCRIPTION-ENGINE.md) | Subscription lifecycle & scheduler |
| 12 | [COMBO-SYSTEM](12-COMBO-SYSTEM.md) | Bundles and combo pricing |
| 13 | [INVENTORY-SYSTEM](13-INVENTORY-SYSTEM.md) | Stock, reservations, perishables |
| 19 | [PAYMENT-ARCHITECTURE](19-PAYMENT-ARCHITECTURE.md) | Gateway-ready payment abstraction |
| 18 | [NOTIFICATION-ARCHITECTURE](18-NOTIFICATION-ARCHITECTURE.md) | Events → channels |
| 20 | [WHATSAPP-FUTURE-INTEGRATION](20-WHATSAPP-FUTURE-INTEGRATION.md) | Where WhatsApp plugs in |

### Security & identity
| # | Document | Purpose |
|---|---|---|
| 07 | [AUTHENTICATION-AUTHORIZATION](07-AUTHENTICATION-AUTHORIZATION.md) | Firebase ↔ our DB |
| 08 | [RBAC-PERMISSIONS](08-RBAC-PERMISSIONS.md) | Roles, permissions, matrix |
| 23 | [SECURITY-ARCHITECTURE](23-SECURITY-ARCHITECTURE.md) | Threats and controls |

### Experience
| # | Document | Purpose |
|---|---|---|
| 14 | [CUSTOMER-UX](14-CUSTOMER-UX.md) | Customer app screens & flows |
| 15 | [ADMIN-UX](15-ADMIN-UX.md) | Admin IA, dashboards, analytics |
| 16 | [MARKETING-WEBSITE](16-MARKETING-WEBSITE.md) | Public site & conversion |
| 17 | [DESIGN-SYSTEM](17-DESIGN-SYSTEM.md) | Brand, tokens, components |
| 21 | [SEO-STRATEGY](21-SEO-STRATEGY.md) | Discoverability |
| 22 | [PERFORMANCE-STRATEGY](22-PERFORMANCE-STRATEGY.md) | Speed budgets & tactics |

### Engineering operations
| # | Document | Purpose |
|---|---|---|
| 24 | [TESTING-STRATEGY](24-TESTING-STRATEGY.md) | Test pyramid & critical scenarios |
| 25 | [DEVOPS-DEPLOYMENT](25-DEVOPS-DEPLOYMENT.md) | Vercel / Railway / Cloudflare |
| 26 | [GITHUB-WORKFLOW](26-GITHUB-WORKFLOW.md) | Branching, PRs, CI |
| 27 | [ENVIRONMENT-CONFIGURATION](27-ENVIRONMENT-CONFIGURATION.md) | Envs and variables |
| 28 | [OBSERVABILITY](28-OBSERVABILITY.md) | Logs, metrics, audit |
| 29 | [BACKUP-DISASTER-RECOVERY](29-BACKUP-DISASTER-RECOVERY.md) | Backups and incidents |
| 37 | [GLOSSARY](37-GLOSSARY.md) | Shared vocabulary |
| 38 | [DOCUMENTATION-AUDIT](38-DOCUMENTATION-AUDIT.md) | Cross-doc consistency audit |

## Conventions used in these docs

- **MUST / SHOULD / MAY** follow RFC 2119 meaning.
- `BR-###` — a numbered business rule, defined in doc 31.
- `ADR-###` — an architecture decision record, defined in doc 36.
- `EC-###` — an edge case, defined in doc 32.
- All money is written as `₹120.00` but **stored as integer paise** (`12000`). See ADR-006.
- All times are `timestamptz` in UTC; business-day logic uses `Asia/Kolkata`. See ADR-007.
