# 26 — GitHub & Development Workflow

## 1. Branching strategy

**Trunk-based with short-lived feature branches.**

```
main ────●────●────●────●────●────►  always deployable, always production
          ╲       ╱      ╲    ╱
           ●─────●        ●──●        feature branches, < 3 days
```

| Branch | Purpose | Protected |
|---|---|---|
| `main` | Production. Every merge deploys. | ✅ |
| `feat/*`, `fix/*`, `chore/*`, `docs/*`, `refactor/*`, `test/*` | Work in progress | — |
| `hotfix/*` | Urgent production fix | — |

### Why not GitFlow with a `develop` branch

The brief suggested `main` + `development` + features. For a small team deploying several
times a week, a long-lived `develop` branch adds a permanent merge tax and a second
integration point, and it routinely diverges from `main` in ways that make releases risky.
Preview deployments already give per-PR staging, and feature flags handle work that must
land before it ships. `develop` is the right answer for scheduled releases with a QA gate;
we do not have those.

**If** a fixed release train becomes necessary (for example, coordinating with a mobile app
release), `develop` is added then — it is a workflow change, not an architectural one.
Recorded as ADR-018.

## 2. Naming

```
feat/subscription-pause-endpoint
fix/slot-capacity-race-condition
chore/upgrade-prisma-5.20
docs/update-api-spec
hotfix/order-total-rounding
```
Lowercase, hyphenated, prefixed by type. Include the issue number when one exists:
`feat/142-subscription-pause`.

## 3. Commits — Conventional Commits

```
<type>(<scope>): <subject>

[body]

[footer]
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`,
`revert`.
Scopes: `api`, `customer`, `admin`, `marketing`, `worker`, `core`, `db`, `ui`, `auth`,
`contracts`, `docs`, `ci`.

```
feat(api): add subscription pause endpoint

Pauses a subscription and cancels future SCHEDULED deliveries.
Already-materialised orders are returned in affected_orders[] and are
not cancelled automatically (EC-S1).

Closes #142
```

Breaking changes use `!` and a `BREAKING CHANGE:` footer. Commitlint enforces the format in a
pre-commit hook and in CI; this is what makes automated changelogs and release notes possible
later without archaeology.

## 4. Pull requests

**Required:** a linked issue or a clear problem statement; a description of the approach;
tests for new behaviour; updated documentation when a documented contract changes; all CI
green; one approving review.

**Size:** target under 400 changed lines. A large PR is split, or it is explained in the
description why it cannot be. Review quality falls off a cliff past a few hundred lines.

### PR template
```markdown
## What
## Why
## How
## Testing
- [ ] Unit tests added/updated
- [ ] Integration tests added/updated
- [ ] Manually verified
## Documentation
- [ ] /docs updated, or not applicable
- [ ] ADR added for any architectural decision
## Database
- [ ] No migration
- [ ] Migration included and backward-compatible with currently running code
- [ ] Expand/contract used for any destructive change
## Security (required for auth, payments, orders, permissions)
- [ ] Authorization checked at the API layer
- [ ] Input validated with Zod
- [ ] No PII added to logs
- [ ] No secret added to the repo
## Screenshots (UI changes)
```

### Review standards
Reviewers check correctness first, then security, then whether it matches `/docs`, then
tests, then readability. Performance on hot paths is checked explicitly. Style is Prettier's
job, not a human's.

**Automatic rejections:** business logic in a React component; a database query in a frontend;
a missing permission declaration on an admin route; string-concatenated SQL; a hard-coded
secret; a float used for money; a new admin endpoint without a permission; a migration that
breaks the currently running code.

## 5. Branch protection on `main`

- No direct pushes, including by admins.
- One approving review required; stale approvals dismissed on new commits.
- All required status checks must pass.
- Branch must be up to date before merging.
- Conversations must be resolved.
- Linear history — **squash merge only**, so `main` is one commit per PR and `git bisect`
  is meaningful.
- Signed commits required (P2).

## 6. CI pipeline

```yaml
# .github/workflows/ci.yml  (shape, not final)
on: [pull_request, push: main]

jobs:
  setup:        pnpm install --frozen-lockfile, turbo cache restore
  lint:         eslint + prettier check          (parallel)
  typecheck:    tsc --noEmit across the workspace
  test-unit:    vitest run packages/core
  test-integration:
                services: postgres:16
                prisma migrate deploy && vitest run apps/api
  migration-check:
                apply migrations to a fresh DB and to a prod-shaped snapshot
  openapi-diff: generate spec, diff against main, fail on a breaking change
  build:        turbo build (all apps)
  bundle-size:  compare against the per-app budget
  security:     pnpm audit --audit-level=high, CodeQL, Gitleaks
  e2e:          (PRs to main) Playwright against the Vercel preview
  lighthouse:   (PRs to main) marketing + customer budgets
```

Turborepo's affected-graph plus remote caching means a change touching only
`apps/admin` does not rerun the marketing build or the API integration suite. Target: under
6 minutes for a typical PR.

## 7. Issues and project management

Labels: `type:feature|bug|chore|docs|security`, `area:api|customer|admin|marketing|db|infra`,
`priority:p0|p1|p2|p3`, `phase:mvp|p2|p3|future`, `good-first-issue`, `blocked`.

Issues are created from [35-IMPLEMENTATION-CHECKLIST.md](35-IMPLEMENTATION-CHECKLIST.md) at
the start of each phase. Board columns: Backlog → Ready → In Progress → In Review →
Done. Work in progress is capped at two items per person.

`p0` means production is broken: it interrupts current work and follows the hotfix path.

## 8. Hotfix path

```
1. Branch from main:  hotfix/order-total-rounding
2. Minimal fix + a test that fails without it
3. PR with the `hotfix` label — expedited review, full CI still required
4. Squash merge → automatic deploy
5. Verify in production; monitor Sentry
6. Post-incident note in the issue (doc 29 §7)
```
CI is never skipped for a hotfix. A broken hotfix under time pressure is how a small outage
becomes a large one.

## 9. Repository hygiene

`CODEOWNERS` routes reviews for `/docs`, `packages/db`, `packages/auth` and
`packages/payments` to the maintainers who own them.
Pre-commit hooks (Husky + lint-staged): Prettier, ESLint on staged files, commitlint,
Gitleaks. Hooks are fast (< 3s) or developers will bypass them.
Dependabot/Renovate: weekly, grouped, patch and minor auto-merged on green CI, majors by hand.

## 10. Documentation discipline

`/docs` is versioned with the code and reviewed in the same PR.

| Change | Documentation required |
|---|---|
| New or changed endpoint | doc 06 |
| Schema change | docs 04 and 05 |
| New business rule | doc 31 |
| Architectural decision | doc 36 (ADR) |
| New edge case handled | doc 32 |
| Phase completed | doc 35 checklist ticked |

A PR that changes a documented contract without updating the document is not approved.
Documentation that drifts from the code is worse than no documentation, because people act
on it.

## 11. Release notes

Generated from Conventional Commits on each deploy to `main`. `feat` and `fix` appear in
customer-visible notes; `chore`, `ci` and `refactor` do not. Tagged `v0.x.y` pre-launch,
`v1.0.0` at launch, semver thereafter, with the API's `/v1` prefix moving only on a genuine
breaking change (doc 06 §14).
