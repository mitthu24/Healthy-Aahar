#!/usr/bin/env node
/**
 * PHASE 03 migration preflight (Fix #6, `20261008120000_phase03_password_auth`).
 *
 * WHY THIS EXISTS
 *
 * That migration adds `CREATE UNIQUE INDEX users_email_user_type_key ON
 * users(email, user_type)`. Postgres treats every NULL as distinct, so
 * existing email-less rows are unaffected — but if ANY two existing rows
 * already share the SAME non-null `(email, user_type)` pair, the index
 * build fails and the whole migration aborts (the migration's own in-SQL
 * guard — see its header comment — raises the same condition during
 * `prisma migrate deploy` itself, as a second, redundant check; this
 * script exists so the same question can be answered BEFORE a deploy is
 * even attempted, against a read replica or a staging clone, with no
 * blast radius if duplicates turn out to exist).
 *
 * READ-ONLY. This script never writes, merges, deletes or renames
 * anything — it only reports. Remediating a reported duplicate (deciding
 * which row keeps the email, and what the other row's email becomes) is a
 * judgement call about real user data and is never made automatically by
 * this script or by the migration.
 *
 * Usage:
 *   node packages/db/scripts/check-duplicate-emails.mjs
 *   (reads DATABASE_URL from the environment, same as every other db script —
 *    run it via `node scripts/with-env.mjs node packages/db/scripts/check-duplicate-emails.mjs`
 *    from the repo root to pick up .env the way `pnpm db:*` scripts do)
 *
 * Exit code: 0 — no duplicates, the migration's unique index is safe to
 * create. 1 — duplicates found; the migration WILL fail until each one is
 * resolved manually. 2 — could not connect / query (treat as "unknown",
 * not "safe").
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const duplicates = await prisma.$queryRaw`
    SELECT email, user_type, COUNT(*)::int AS row_count
    FROM users
    WHERE email IS NOT NULL
    GROUP BY email, user_type
    HAVING COUNT(*) > 1
    ORDER BY row_count DESC
  `;

  if (duplicates.length === 0) {
    console.warn('OK: no duplicate (email, user_type) pairs found. The PHASE 03 unique index is safe to create.');
    return 0;
  }

  console.error(`BLOCKED: found ${duplicates.length} duplicate (email, user_type) pair(s):\n`);
  for (const row of duplicates) {
    console.error(`  - email=${row.email}  user_type=${row.user_type}  rows=${row.row_count}`);
  }
  console.error(
    '\nThe PHASE 03 migration (20261008120000_phase03_password_auth) will fail to create its' +
      '\nunique index until each pair above is resolved. For each one, inspect the conflicting rows:' +
      '\n\n  SELECT id, email, user_type, firebase_uid, status, created_at FROM users' +
      "\n  WHERE email = '<email>' AND user_type = '<user_type>';" +
      '\n\nThen decide, per row, whether to: merge the two accounts (a business decision, not a' +
      '\ntechnical one), rename/correct one row\'s email if it was a data-entry error, or null the' +
      '\nemail on whichever row should not keep it. This script and the migration both refuse to' +
      '\nmake that choice for you — nothing is modified automatically.',
  );
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error('Could not run the duplicate-email preflight check:', error);
    process.exit(2);
  })
  .finally(() => prisma.$disconnect());
