import { DomainError } from './errors.js';

/**
 * Business scoping.
 *
 * Every operational query is scoped to one business (ADR-005). This is not a
 * filter applied after fetching — it belongs in the WHERE clause, so there is
 * no "fetch then check" step anyone can forget (docs/23 §4).
 *
 * The branded type below makes that discipline visible to the type checker: a
 * repository takes a `BusinessScope`, not a bare string, so a caller cannot
 * accidentally pass a user id, a city id, or nothing at all.
 */

declare const businessScopeBrand: unique symbol;

export type BusinessScope = string & { readonly [businessScopeBrand]: true };

export function businessScope(businessId: string): BusinessScope {
  if (!businessId || businessId.trim().length === 0) {
    throw new DomainError('INTERNAL_ERROR', 'Business scope is required', {
      context: { reason: 'empty business id passed to businessScope()' },
    });
  }
  return businessId as BusinessScope;
}

/**
 * Assert that a fetched row belongs to the scoped business.
 *
 * A defence-in-depth check for the rare path that cannot express scoping in
 * SQL — a raw query, or a row reached through an unscoped relation. If this
 * ever throws, a query is missing its business filter, which is a bug worth
 * failing loudly for rather than silently serving another tenant's data.
 */
export function assertInScope(
  row: { businessId: string } | null | undefined,
  scope: BusinessScope,
  resource: string,
): void {
  if (!row) return;

  if (row.businessId !== scope) {
    throw new DomainError('NOT_FOUND', `${resource} not found.`, {
      context: {
        reason: 'cross-business access attempt',
        resource,
        expected: scope,
        actual: row.businessId,
      },
    });
  }
}

/**
 * Cross-business access returns NOT_FOUND, never FORBIDDEN.
 *
 * A 403 confirms the resource exists, which is an enumeration oracle
 * (docs/06 §1.6). This helper exists so that rule is applied by construction
 * rather than remembered at each call site.
 */
export function notFoundInScope(resource: string): DomainError {
  return new DomainError('NOT_FOUND', `${resource} not found.`);
}
