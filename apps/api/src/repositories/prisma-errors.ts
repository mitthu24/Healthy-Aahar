/**
 * Narrow, reusable Prisma error matching (Fix #3).
 *
 * `invite()` and `createCustomerWithPassword()` each run a multi-statement
 * transaction with MORE than one unique/primary-key constraint in play
 * (e.g. `adminUserRole`'s composite `(admin_user_id, role_id)` primary
 * key, alongside `users`' `(email, user_type)` unique index) — a blanket
 * `error.code === 'P2002'` check cannot tell those apart and would
 * misreport an unrelated collision (a caller-supplied duplicate role id)
 * as "email already registered". This checks the violated constraint's
 * `meta.target` for the field name actually in question.
 */
export function isUniqueConstraintViolation(error: unknown, fieldHint: string): boolean {
  const err = error as { code?: string; meta?: { target?: string[] | string } };
  if (err?.code !== 'P2002') return false;

  const target = err.meta?.target;
  if (!target) return false;

  const haystack = Array.isArray(target) ? target.join(',') : target;
  return haystack.toLowerCase().includes(fieldHint.toLowerCase());
}
