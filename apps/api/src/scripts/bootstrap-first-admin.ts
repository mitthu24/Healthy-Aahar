#!/usr/bin/env node
/**
 * ONE-TIME, MANUAL first-admin bootstrap.
 *
 * Gap this fills: the only way to create an admin, `RbacService.inviteAdmin`
 * (via `POST /v1/admin/admin-users`), requires an already-authenticated
 * admin actor with `admin_users:create` — and `prisma/seed.ts` deliberately
 * creates no admin (business/cities/settings/RBAC roles only). There is no
 * self-service or seed-based way to create the very first admin.
 *
 * This script creates exactly one Super Admin `users` + `admin_users` +
 * `admin_user_roles` row, in the same shape `PrismaAdminRepository.invite()`
 * already creates (no `password_hash` — a credential is established only
 * via the password-setup token flow), and issues a one-time setup token
 * through the SAME single authorized issuance path every other admin invite
 * uses (`PasswordResetService.issueToken`). It never sets a password and
 * never invents a bypass of its own.
 *
 * SAFETY
 *  - Refuses outright if any admin already exists for the business. The
 *    check and every write happen inside ONE transaction holding a Postgres
 *    advisory lock for its full duration, so two concurrent invocations can
 *    never both observe "no admin exists yet" and both proceed.
 *  - Requires an EXPLICIT --database-url (or BOOTSTRAP_DATABASE_URL env
 *    var). It never reads the ambient DATABASE_URL, under any fallback —
 *    see bootstrap-first-admin-config.ts for why.
 *  - Prints only the database host/port/name (never the username or
 *    password) before doing anything, and performs a dry run unless --yes
 *    is passed — nothing connects to the database without it.
 *  - Refuses under CI (CI=true / GITHUB_ACTIONS=true) — see
 *    bootstrap-first-admin-config.ts.
 *  - The ONLY secret this script ever prints is the final, one-time
 *    password-setup link, exactly once, as its entire purpose — nothing
 *    here goes through a logger, and no password or hash is ever generated,
 *    read, or set by this script.
 *
 * USAGE (never add this to CI, a Makefile, or any automated pipeline):
 *
 *   pnpm --filter @healthy-aahar/api bootstrap:first-admin -- \
 *     --database-url "postgresql://user:pass@host:5432/db" \
 *     --email you@example.com \
 *     --name "Your Name" \
 *     --yes
 *
 * Operator procedure after it prints a link:
 *   1. Copy the link/token directly off this terminal. Do not paste it into
 *      chat, a ticket, or an email in plaintext, and never commit it.
 *   2. There is currently no admin-panel page that consumes `?token=` (only
 *      `/login` and the self-service `/change-password` exist today — see
 *      the accompanying investigation report). Redeem it directly:
 *        curl -X POST https://<api host>/v1/auth/password/setup \
 *          -H "Content-Type: application/json" \
 *          -d '{"token":"<token>","password":"<a new password, chosen now>"}'
 *   3. Sign in at the admin app's /login with that email and password.
 *   4. The token is single-use and expires in 7 days either way.
 */
import { newId, PasswordResetService } from '@healthy-aahar/core';
import { scryptPasswordHasher, sha256SessionTokenHasher } from '@healthy-aahar/auth';
import { createDatabaseClient, type PrismaClient } from '@healthy-aahar/db';

import { isUniqueConstraintViolation } from '../repositories/prisma-errors.js';
import { PrismaPasswordResetRepository } from '../repositories/prisma-password-reset-repository.js';
import { PrismaSessionRepository } from '../repositories/prisma-session-repository.js';
import { PrismaUserRepository } from '../repositories/prisma-user-repository.js';

import { describeDatabaseTarget, resolveBootstrapConfig } from './bootstrap-first-admin-config.js';

/**
 * Fixed, arbitrary key for a Postgres transaction-scoped advisory lock
 * (`pg_advisory_xact_lock` takes a bigint; released automatically when the
 * transaction ends, win or lose). Serializes concurrent bootstrap attempts:
 * the second caller blocks here until the first's transaction commits or
 * rolls back, then re-runs the "does an admin already exist" check inside
 * its own lock-holding transaction and refuses — so two operators (or one
 * fat-fingered double run) can never both succeed.
 */
const BOOTSTRAP_LOCK_KEY = 7_261_572_019n;

export type BootstrapResult =
  | {
      ok: true;
      userId: string;
      adminUserId: string;
      email: string;
      passwordSetupLink: string;
    }
  | { ok: false; reason: 'ADMIN_ALREADY_EXISTS' }
  | { ok: false; reason: 'EMAIL_TAKEN' }
  | { ok: false; reason: 'NO_BUSINESS' }
  | { ok: false; reason: 'NO_SUPER_ADMIN_ROLE' };

/**
 * Creates the first Super Admin and issues its setup token. Exported so
 * tests (and the CLI below) can call it directly against a Prisma client,
 * without going through argv/stdout.
 */
export async function bootstrapFirstAdmin(
  prisma: PrismaClient,
  params: { email: string; fullName: string; continueUrl?: string | undefined },
): Promise<BootstrapResult> {
  const created = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${BOOTSTRAP_LOCK_KEY})`);

      const business = await tx.business.findFirst({ select: { id: true } });
      if (!business) return { ok: false as const, reason: 'NO_BUSINESS' as const };

      // The refusal this whole script exists to enforce — re-checked here,
      // inside the lock, not before it (see BOOTSTRAP_LOCK_KEY doc above).
      const existingAdminCount = await tx.adminUser.count({
        where: { businessId: business.id },
      });
      if (existingAdminCount > 0) {
        return { ok: false as const, reason: 'ADMIN_ALREADY_EXISTS' as const };
      }

      const role = await tx.role.findUnique({
        where: { businessId_key: { businessId: business.id, key: 'SUPER_ADMIN' } },
        select: { id: true },
      });
      if (!role) return { ok: false as const, reason: 'NO_SUPER_ADMIN_ROLE' as const };

      const userId = newId();
      const adminUserId = newId();

      try {
        // No `passwordHash` — identical in shape to
        // `PrismaAdminRepository.invite()`; a credential is established
        // only through the setup-token flow below.
        await tx.user.create({
          data: {
            id: userId,
            userType: 'ADMIN',
            email: params.email,
            emailVerified: false,
            status: 'ACTIVE',
          },
        });
      } catch (error) {
        if (isUniqueConstraintViolation(error, 'email')) {
          return { ok: false as const, reason: 'EMAIL_TAKEN' as const };
        }
        throw error;
      }

      await tx.adminUser.create({
        data: {
          id: adminUserId,
          businessId: business.id,
          userId,
          fullName: params.fullName,
          isSuperAdmin: true,
          // No authenticated actor invited this one — left null rather
          // than attributed to a fabricated identity (admin_users.invited_by
          // is nullable for exactly this reason: onDelete: SetNull).
          invitedBy: null,
          // Explicit, persisted gate (not inferred from lastPasswordChangeAt
          // — see AdminActor.mustChangePassword's doc comment): this admin's
          // first real password will be whatever the operator types when
          // redeeming the setup token below, known to whoever delivered it,
          // not chosen privately the way a normal invite's setup is. The
          // admin-auth middleware blocks every route but auth/me,
          // change-password and logout until it's cleared.
          mustChangePassword: true,
        },
      });

      await tx.adminUserRole.create({
        data: { adminUserId, roleId: role.id, grantedBy: null },
      });

      // Same audit action RbacService.inviteAdmin writes
      // (`admin_user.invited`), but `actorType: 'SYSTEM'` / `actorUserId:
      // null` — the same actor type worker jobs already use for actions
      // with no human on the other end (docs/07 §7), not a fabricated
      // admin identity.
      await tx.auditLog.create({
        data: {
          id: newId(),
          businessId: business.id,
          actorUserId: null,
          actorType: 'SYSTEM',
          action: 'admin_user.invited',
          resourceType: 'admin_user',
          resourceId: adminUserId,
          metadata: {
            email: params.email,
            roles: ['SUPER_ADMIN'],
            source: 'bootstrap-first-admin',
          },
        },
      });

      return { ok: true as const, userId, adminUserId };
    },
    { timeout: 10_000 },
  );

  if (!created.ok) return created;

  // Token issuance is deliberately OUTSIDE the transaction above — this
  // mirrors RbacService.inviteAdmin exactly, which also calls
  // admins.invite() and then passwordReset.issueToken() as two separate
  // steps, not one atomic unit.
  const passwordReset = new PasswordResetService(
    new PrismaUserRepository(prisma),
    new PrismaPasswordResetRepository(prisma),
    new PrismaSessionRepository(prisma),
    scryptPasswordHasher,
    sha256SessionTokenHasher,
  );

  const passwordSetupLink = await passwordReset.issueToken({
    userId: created.userId,
    purpose: 'SETUP',
    continueUrl: params.continueUrl,
  });

  return {
    ok: true,
    userId: created.userId,
    adminUserId: created.adminUserId,
    email: params.email,
    passwordSetupLink,
  };
}

async function main(): Promise<void> {
  const configResult = resolveBootstrapConfig(process.argv.slice(2), process.env);
  if (!configResult.ok) {
    console.error(`[bootstrap-first-admin] ${configResult.error}`);
    process.exitCode = 1;
    return;
  }
  const { config } = configResult;

  console.error(
    `[bootstrap-first-admin] target database: ${describeDatabaseTarget(config.databaseUrl)}`,
  );
  console.error(`[bootstrap-first-admin] email: ${config.email}`);
  console.error(`[bootstrap-first-admin] full name: ${config.fullName}`);

  if (!config.confirmed) {
    console.error(
      '[bootstrap-first-admin] Dry run (no --yes passed) — nothing was connected to or ' +
        'written. Re-run with --yes once the database printed above is confirmed correct.',
    );
    return;
  }

  const prisma = createDatabaseClient({ databaseUrl: config.databaseUrl });
  try {
    const result = await bootstrapFirstAdmin(prisma, {
      email: config.email,
      fullName: config.fullName,
      continueUrl: config.continueUrl,
    });

    if (!result.ok) {
      const messages: Record<(typeof result)['reason'], string> = {
        ADMIN_ALREADY_EXISTS:
          'Refusing: an admin account already exists for this business. This script only ' +
          "ever creates the FIRST admin — use the admin panel's invite flow, or " +
          'POST /v1/admin/admin-users/{id}/reset-password, for every admin after that.',
        EMAIL_TAKEN: 'An account with this email already exists.',
        NO_BUSINESS: 'No business row found — run the main seed (pnpm db:seed) first.',
        NO_SUPER_ADMIN_ROLE: 'SUPER_ADMIN role not found — run the main seed (pnpm db:seed) first.',
      };
      console.error(`[bootstrap-first-admin] ${messages[result.reason]}`);
      process.exitCode = 1;
      return;
    }

    console.error(
      `[bootstrap-first-admin] created Super Admin ${result.email} (user_id=${result.userId}).`,
    );
    console.error(
      '[bootstrap-first-admin] One-time password-setup link below — valid 7 days, single use. ' +
        'Copy it directly off this terminal now; do not paste it into chat, a ticket, or an ' +
        'email in plaintext, and never commit it anywhere.',
    );
    // The ONLY place this script ever prints a raw secret — deliberately,
    // once, as its entire purpose. This is not a log line (nothing here
    // goes through a logger); it is the one piece of output the operator
    // must capture to complete setup.
    process.stdout.write(`${result.passwordSetupLink}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('[bootstrap-first-admin] failed:', error);
  process.exitCode = 1;
});
