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
 *  - Refuses unless exactly one ACTIVE Super Admin exists for the business
 *    AND that admin's email matches --email exactly — an ambiguous target
 *    (zero, or more than one active Super Admin) is refused rather than
 *    guessed at. If more than one active Super Admin already exists, use
 *    the authorized `POST /v1/admin/admin-users/{id}/reset-password` route
 *    instead (one of them can call it) — this script is only for the
 *    narrow case where no admin can sign in at all.
 *  - Never creates a user, admin, or role row. Never runs raw/ad-hoc SQL —
 *    every read and write goes through the same repository classes the
 *    HTTP routes use.
 *  - The ONLY secret this script ever prints is the final, one-time
 *    password-setup link, exactly once, as its entire purpose — nothing
 *    here goes through a logger, and no password or hash is ever generated,
 *    read, or set by this script.
 *
 * USAGE (never add this to CI, a Makefile, or any automated pipeline):
 *
 *   pnpm --filter @healthy-aahar/api recover:admin-password-setup -- \
 *     --database-url "postgresql://user:pass@host:5432/db" \
 *     --email admin@gmail.com \
 *     --yes
 *
 * Operator procedure after it prints a link:
 *   1. Copy the link/token directly off this terminal. Do not paste it into
 *      chat, a ticket, or an email in plaintext, and never commit it.
 *   2. Redeem it directly:
 *        curl -X POST https://<api host>/v1/auth/password/setup \
 *          -H "Content-Type: application/json" \
 *          -d '{"token":"<token>","password":"<a new password, chosen now>"}'
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
  | { ok: true; email: string; passwordSetupLink: string }
  | { ok: false; reason: 'NO_BUSINESS' }
  | { ok: false; reason: 'ADMIN_NOT_FOUND' }
  | { ok: false; reason: 'NOT_SUPER_ADMIN' }
  | { ok: false; reason: 'ACCOUNT_INACTIVE' }
  | { ok: false; reason: 'AMBIGUOUS_SUPER_ADMIN_COUNT'; activeSuperAdminCount: number };

/**
 * Finds the existing Super Admin by email and issues a fresh password-setup
 * link. Exported so tests (and the CLI below) can call it directly against
 * a Prisma client, without going through argv/stdout.
 */
export async function recoverAdminPasswordSetup(
  prisma: PrismaClient,
  params: { email: string; continueUrl?: string | undefined },
): Promise<RecoveryResult> {
  const business = await prisma.business.findFirst({ select: { id: true } });
  if (!business) return { ok: false, reason: 'NO_BUSINESS' };
  const scope = businessScope(business.id);

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

      const messages: Record<Exclude<(typeof result)['reason'], 'AMBIGUOUS_SUPER_ADMIN_COUNT'>, string> =
        {
          NO_BUSINESS: 'No business row found — run the main seed (pnpm db:seed) first.',
          ADMIN_NOT_FOUND: 'No admin account found for this email.',
          NOT_SUPER_ADMIN: 'This account exists but is not a Super Admin.',
          ACCOUNT_INACTIVE: 'This account exists but is suspended or deactivated.',
        };
      console.error(`[recover-admin-password-setup] ${messages[result.reason]}`);
      process.exitCode = 1;
      return;
    }

    console.error(`[recover-admin-password-setup] recovered access for ${result.email}.`);
    console.error(
      '[recover-admin-password-setup] One-time password-setup link below — valid 7 days, ' +
        'single use. Copy it directly off this terminal now; do not paste it into chat, a ' +
        'ticket, or an email in plaintext, and never commit it anywhere.',
    );
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
