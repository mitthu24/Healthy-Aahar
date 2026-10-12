#!/usr/bin/env node
/**
 * ONE-TIME, MANUAL admin password-setup recovery.
 *
 * Gap this fills: `bootstrap-first-admin.ts` created a Super Admin and
 * printed a one-time password-setup link to the operator's terminal — if
 * that link is lost before being redeemed, there is no self-service way to
 * get another one (the account has no password yet, so it cannot log in,
 * and `RbacService.resetAdminPassword` requires an already-authenticated
 * admin actor to call it, which does not yet exist).
 *
 * This script does NOT create an admin, does NOT touch password or token
 * tables directly, and does NOT weaken any authorization check. It finds the
 * existing Super Admin by email (through `UserRepository`/`AdminRepository`,
 * the same abstractions every authenticated route uses) and issues a fresh
 * single-use token through the SAME `PasswordResetService.issueToken` path
 * `RbacService.resetAdminPassword` already uses for this exact purpose
 * (`purpose: 'RESET'`) — it is the unauthenticated-operator equivalent of
 * that authorized route, not a new mechanism.
 *
 * SAFETY
 *  - Requires an EXPLICIT --database-url (or RECOVERY_DATABASE_URL env
 *    var). Never reads the ambient DATABASE_URL — see
 *    recover-admin-password-setup-config.ts for why.
 *  - Prints only the database host/port/name (never the username or
 *    password) before doing anything, and performs a dry run unless --yes
 *    is passed — nothing connects to the database without it.
 *  - Refuses under CI (CI=true / GITHUB_ACTIONS=true).
 *  - Targets ONE explicit business: pass --business-id, or — if omitted —
 *    the script requires that exactly one business row exists at all and
 *    refuses otherwise (`NO_BUSINESS` / `AMBIGUOUS_BUSINESS`). It never
 *    picks "the first business it finds" out of several, which would risk
 *    issuing a token scoped to the wrong tenant.
 *  - Refuses unless exactly one ACTIVE Super Admin exists for the chosen
 *    business AND that admin's email matches --email exactly — an
 *    ambiguous target (zero, or more than one active Super Admin) is
 *    refused rather than guessed at. If more than one active Super Admin
 *    already exists, use the authorized
 *    `POST /v1/admin/admin-users/{id}/reset-password` route instead (one
 *    of them can call it) — this script is only for the narrow case where
 *    no admin can sign in at all.
 *  - Never creates a user, admin, or role row. Never runs raw/ad-hoc SQL —
 *    every read and write goes through the same repository classes the
 *    HTTP routes use.
 *  - The ONLY secret this script ever prints is the final, one-time
 *    password-setup credential, exactly once, as its entire purpose —
 *    nothing here goes through a logger, and no password or hash is ever
 *    generated, read, or set by this script.
 *
 * OUTPUT: a TOKEN, not necessarily a clickable URL. `PasswordResetService
 * .issueToken()` returns a bare raw token unless `--continue-url` is given,
 * in which case it returns `<continue-url>?token=<raw>`. Without
 * `--continue-url` (the default — there is currently no admin-panel page
 * that consumes `?token=`), what this script prints is NOT a link; it is
 * the token value itself, redeemed by POSTing it directly to the API (see
 * "Operator procedure" below). Treat it exactly like a password: do not
 * paste it anywhere other than that one API call.
 *
 * USAGE (never add this to CI, a Makefile, or any automated pipeline):
 *
 *   pnpm --filter @healthy-aahar/api recover:admin-password-setup -- \
 *     --database-url "postgresql://user:pass@host:5432/db" \
 *     --business-id "<the business's id>" \
 *     --email admin@gmail.com \
 *     --yes
 *
 *   (--business-id may be omitted only if the target database has exactly
 *   one business row — the script will say so if it does not.)
 *
 * Operator procedure after it prints a credential:
 *   1. Copy it directly off this terminal. Do not paste it into chat, a
 *      ticket, or an email in plaintext, and never commit it.
 *   2a. If you ran WITHOUT --continue-url (the default), what you copied is
 *       the raw token. Redeem it directly:
 *         curl -X POST https://<api host>/v1/auth/password/setup \
 *           -H "Content-Type: application/json" \
 *           -d '{"token":"<token>","password":"<a new password, chosen now>"}'
 *   2b. If you ran WITH --continue-url, what you copied is a full URL of the
 *       form `<continue-url>?token=<raw>` — extract the `token` query
 *       parameter and redeem it the same way as 2a, or open the URL if the
 *       admin app has a page that consumes it.
 *   3. Sign in at the admin app's /login with that email and password.
 *   4. The token is single-use and expires in 7 days either way.
 */
import { PasswordResetService } from '@healthy-aahar/core';
import { scryptPasswordHasher, sha256SessionTokenHasher } from '@healthy-aahar/auth';
import { businessScope } from '@healthy-aahar/core';
import { createDatabaseClient, type PrismaClient } from '@healthy-aahar/db';

import { PrismaAdminRepository } from '../repositories/prisma-admin-repository.js';
import { PrismaPasswordResetRepository } from '../repositories/prisma-password-reset-repository.js';
import { PrismaSessionRepository } from '../repositories/prisma-session-repository.js';
import { PrismaUserRepository } from '../repositories/prisma-user-repository.js';

import {
  describeDatabaseTarget,
  resolveRecoveryConfig,
} from './recover-admin-password-setup-config.js';

export type RecoveryResult =
  | {
      ok: true;
      email: string;
      /**
       * Despite the name (kept consistent with `bootstrap-first-admin.ts`'s
       * `BootstrapResult`), this is a bare raw TOKEN unless a `continueUrl`
       * was passed in — only then is it `<continueUrl>?token=<raw>`, an
       * actual clickable URL. See this file's header comment, section
       * "OUTPUT", before assuming it's safe to treat as a link.
       */
      passwordSetupLink: string;
    }
  | { ok: false; reason: 'NO_BUSINESS' }
  | { ok: false; reason: 'BUSINESS_NOT_FOUND' }
  | { ok: false; reason: 'AMBIGUOUS_BUSINESS'; businessCount: number }
  | { ok: false; reason: 'ADMIN_NOT_FOUND' }
  | { ok: false; reason: 'NOT_SUPER_ADMIN' }
  | { ok: false; reason: 'ACCOUNT_INACTIVE' }
  | { ok: false; reason: 'AMBIGUOUS_SUPER_ADMIN_COUNT'; activeSuperAdminCount: number };

/**
 * Finds the existing Super Admin by email, within ONE explicit business,
 * and issues a fresh password-setup token. Exported so tests (and the CLI
 * below) can call it directly against a Prisma client, without going
 * through argv/stdout.
 */
export async function recoverAdminPasswordSetup(
  prisma: PrismaClient,
  params: { email: string; businessId?: string | undefined; continueUrl?: string | undefined },
): Promise<RecoveryResult> {
  let resolvedBusinessId: string;
  if (params.businessId !== undefined) {
    // An explicit --business-id must name a REAL business — never trusted
    // as-is, since a typo'd or stale id would otherwise silently resolve to
    // "no matching admin" (ADMIN_NOT_FOUND) rather than the more honest
    // "that business doesn't exist" refusal.
    const business = await prisma.business.findUnique({
      where: { id: params.businessId },
      select: { id: true },
    });
    if (!business) return { ok: false, reason: 'BUSINESS_NOT_FOUND' };
    resolvedBusinessId = business.id;
  } else {
    // No --business-id given: only auto-select a business when there is
    // exactly one in the whole database. This is deliberately stricter than
    // bootstrap-first-admin.ts's `findFirst()` — that script can only ever
    // create a brand new account (nothing pre-existing to misdirect), while
    // this one must not silently reuse a token meant for a DIFFERENT
    // business's Super Admin just because `findFirst()` happened to return
    // one first.
    const businesses = await prisma.business.findMany({ select: { id: true }, take: 2 });
    if (businesses.length === 0) return { ok: false, reason: 'NO_BUSINESS' };
    if (businesses.length > 1) {
      const businessCount = await prisma.business.count();
      return { ok: false, reason: 'AMBIGUOUS_BUSINESS', businessCount };
    }
    resolvedBusinessId = businesses[0]!.id;
  }
  const scope = businessScope(resolvedBusinessId);

  const users = new PrismaUserRepository(prisma);
  const admins = new PrismaAdminRepository(prisma);

  // Refuse on ANY ambiguity before touching the specific account below —
  // this is the "exactly one matching active Super Admin exists" guard the
  // task requires, checked independently of the email lookup so a caller
  // cannot be misled by a business with e.g. two active Super Admins where
  // only one happens to match the email given.
  const activeSuperAdminCount = await admins.countActiveSuperAdmins(scope);
  if (activeSuperAdminCount !== 1) {
    return { ok: false, reason: 'AMBIGUOUS_SUPER_ADMIN_COUNT', activeSuperAdminCount };
  }

  const user = await users.findByEmail(params.email, 'ADMIN');
  if (!user) return { ok: false, reason: 'ADMIN_NOT_FOUND' };

  const found = await admins.findByUserId(scope, user.id);
  if (!found || found.admin.deletedAt) return { ok: false, reason: 'ADMIN_NOT_FOUND' };
  if (!found.admin.isSuperAdmin) return { ok: false, reason: 'NOT_SUPER_ADMIN' };
  if (user.status !== 'ACTIVE') return { ok: false, reason: 'ACCOUNT_INACTIVE' };

  // Same issuance path `RbacService.resetAdminPassword` uses for an
  // existing admin — same purpose, same TTL, same single-use guarantee.
  const passwordReset = new PasswordResetService(
    users,
    new PrismaPasswordResetRepository(prisma),
    new PrismaSessionRepository(prisma),
    scryptPasswordHasher,
    sha256SessionTokenHasher,
  );

  const passwordSetupLink = await passwordReset.issueToken({
    userId: user.id,
    purpose: 'RESET',
    continueUrl: params.continueUrl,
  });

  return { ok: true, email: params.email, passwordSetupLink };
}

async function main(): Promise<void> {
  const configResult = resolveRecoveryConfig(process.argv.slice(2), process.env);
  if (!configResult.ok) {
    console.error(`[recover-admin-password-setup] ${configResult.error}`);
    process.exitCode = 1;
    return;
  }
  const { config } = configResult;

  console.error(
    `[recover-admin-password-setup] target database: ${describeDatabaseTarget(config.databaseUrl)}`,
  );
  console.error(`[recover-admin-password-setup] email: ${config.email}`);
  console.error(
    `[recover-admin-password-setup] business: ${config.businessId ?? '(none given — requires exactly one business row to exist)'}`,
  );

  if (!config.confirmed) {
    console.error(
      '[recover-admin-password-setup] Dry run (no --yes passed) — nothing was connected to ' +
        'or written. Re-run with --yes once the database printed above is confirmed correct.',
    );
    return;
  }

  const prisma = createDatabaseClient({ databaseUrl: config.databaseUrl });
  try {
    const result = await recoverAdminPasswordSetup(prisma, {
      email: config.email,
      businessId: config.businessId,
      continueUrl: config.continueUrl,
    });

    if (!result.ok) {
      if (result.reason === 'AMBIGUOUS_SUPER_ADMIN_COUNT') {
        console.error(
          `[recover-admin-password-setup] Refusing: found ${result.activeSuperAdminCount} ` +
            'active Super Admin(s) for this business, expected exactly 1. If more than one ' +
            'exists, use POST /v1/admin/admin-users/{id}/reset-password from one of them ' +
            'instead. If zero exist, use bootstrap-first-admin.ts instead — there is no ' +
            'existing account for this script to recover.',
        );
        process.exitCode = 1;
        return;
      }
      if (result.reason === 'AMBIGUOUS_BUSINESS') {
        console.error(
          `[recover-admin-password-setup] Refusing: found ${result.businessCount} business ` +
            'rows and no --business-id was given. Re-run with --business-id <id> naming the ' +
            'exact business whose Super Admin you are recovering.',
        );
        process.exitCode = 1;
        return;
      }

      const messages: Record<
        Exclude<(typeof result)['reason'], 'AMBIGUOUS_SUPER_ADMIN_COUNT' | 'AMBIGUOUS_BUSINESS'>,
        string
      > = {
        NO_BUSINESS: 'No business row found — run the main seed (pnpm db:seed) first.',
        BUSINESS_NOT_FOUND: 'No business row matches the given --business-id.',
        ADMIN_NOT_FOUND: 'No admin account found for this email.',
        NOT_SUPER_ADMIN: 'This account exists but is not a Super Admin.',
        ACCOUNT_INACTIVE: 'This account exists but is suspended or deactivated.',
      };
      console.error(`[recover-admin-password-setup] ${messages[result.reason]}`);
      process.exitCode = 1;
      return;
    }

    console.error(`[recover-admin-password-setup] recovered access for ${result.email}.`);
    if (config.continueUrl) {
      console.error(
        '[recover-admin-password-setup] One-time password-setup LINK below (built from your ' +
          '--continue-url) — valid 7 days, single use. Copy it directly off this terminal ' +
          'now; do not paste it into chat, a ticket, or an email in plaintext, and never ' +
          'commit it anywhere.',
      );
    } else {
      console.error(
        '[recover-admin-password-setup] One-time password-setup TOKEN below (no --continue-url ' +
          'was given, so this is the raw token, NOT a clickable URL) — valid 7 days, single ' +
          'use. Redeem it by POSTing it to the password-setup API (see the usage comment atop ' +
          'this file for the exact curl command); do not paste it into chat, a ticket, or an ' +
          'email in plaintext, and never commit it anywhere.',
      );
    }
    // The ONLY place this script ever prints a raw secret — deliberately,
    // once, as its entire purpose. This is not a log line (nothing here
    // goes through a logger); it is the one piece of output the operator
    // must capture to complete recovery.
    process.stdout.write(`${result.passwordSetupLink}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('[recover-admin-password-setup] failed:', error);
  process.exitCode = 1;
});
