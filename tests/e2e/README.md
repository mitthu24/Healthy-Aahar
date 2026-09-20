# End-to-end tests

Playwright suites covering the cross-app journeys in
[docs/24-TESTING-STRATEGY.md](../../docs/24-TESTING-STRATEGY.md) section 6.

**Empty at PHASE 01 by design.** There is no customer journey to test yet — the apps are
shells. The first suites arrive in PHASE 07 (browse, cart, checkout, order placed) once
there is a journey worth protecting.

Writing E2E tests against placeholder pages would produce tests that pass today, break on
the first real screen, and teach the team that E2E failures are noise. That is a worse
outcome than having none.

Unit and integration coverage for PHASE 01 lives with the code it tests:

| Suite                                                    | Location                                                    |
| -------------------------------------------------------- | ----------------------------------------------------------- |
| Serviceability rules (all 9 city x pincode combinations) | `packages/core/src/domain/serviceability.test.ts`           |
| Money, rounding, Indian formatting                       | `packages/core/src/domain/money.test.ts`                    |
| Time, IST boundaries, slot-time conversion               | `packages/core/src/domain/time.test.ts`                     |
| Serviceability service, checkout guard                   | `packages/core/src/services/serviceability-service.test.ts` |
| Contract schemas and error catalogue                     | `packages/contracts/src/contracts.test.ts`                  |
| Route registry boot assertions                           | `apps/api/src/lib/route-registry.test.ts`                   |
| API endpoints, headers, CORS, no-browser-context         | `apps/api/src/app.test.ts`                                  |
