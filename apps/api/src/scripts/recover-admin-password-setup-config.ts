import { parseArgs } from 'node:util';

import { z } from 'zod';

/**
 * CLI/env config resolution for `recover-admin-password-setup.ts`.
 *
 * Pure and side-effect-free (no DB connection, no `process.exit`) so it can
 * be unit tested directly, without a database — mirrors
 * `bootstrap-first-admin-config.ts` exactly, including why database
 * targeting never reads the ambient `DATABASE_URL`: an operator-run script
 * that re-issues a credential-bearing link must never be able to silently
 * land on whatever database happened to be ambiently configured.
 */

const emailSchema = z.string().trim().email();
const urlSchema = z.string().url();

export type RecoveryConfig = {
  databaseUrl: string;
  email: string;
  /**
   * Optional — when omitted, the script itself refuses unless exactly one
   * business row exists (see `recoverAdminPasswordSetup`'s `NO_BUSINESS`/
   * `AMBIGUOUS_BUSINESS` results). Not validated as a UUID here: the
   * database is the only authority on whether it refers to a real business.
   */
  businessId: string | undefined;
  continueUrl: string | undefined;
  /** True only if `--yes` was passed. Without it, the caller must dry-run only. */
  confirmed: boolean;
};

export type RecoveryConfigResult =
  { ok: true; config: RecoveryConfig } | { ok: false; error: string };

export function resolveRecoveryConfig(
  argv: string[],
  env: Record<string, string | undefined>,
): RecoveryConfigResult {
  // This script prints a one-time, reusable secret (the password-setup
  // link) to stdout as its whole purpose. It must never run anywhere that
  // output could land in a shared, retained log — refuse outright rather
  // than trust a doc comment alone.
  if (env.CI === 'true' || env.GITHUB_ACTIONS === 'true') {
    return {
      ok: false,
      error:
        'Refusing to run under CI (CI=true or GITHUB_ACTIONS=true is set). This script prints ' +
        'a one-time secret to stdout and must only ever be run manually, by a human, at a ' +
        'terminal they control — never in an automated/CI context.',
    };
  }

  const PARSE_OPTIONS = {
    'database-url': { type: 'string' },
    email: { type: 'string' },
    'business-id': { type: 'string' },
    'continue-url': { type: 'string' },
    yes: { type: 'boolean', default: false },
  } as const;

  let parsed: ReturnType<typeof parseArgs<{ args: string[]; options: typeof PARSE_OPTIONS }>>;
  try {
    parsed = parseArgs({
      args: argv,
      options: PARSE_OPTIONS,
      strict: true,
      allowPositionals: false,
    });
  } catch (error) {
    return { ok: false, error: `Could not parse arguments: ${(error as Error).message}` };
  }
  const values = parsed.values;

  const databaseUrl = values['database-url'] ?? env.RECOVERY_DATABASE_URL;
  if (!databaseUrl) {
    return {
      ok: false,
      error:
        'No target database given. Pass --database-url <url> or set RECOVERY_DATABASE_URL. ' +
        "DATABASE_URL (the app's own ambient variable) is never read by this script, even if " +
        'it happens to be set in the environment — the target must be explicit on every run ' +
        '(fail-closed by design).',
    };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(databaseUrl);
  } catch {
    return { ok: false, error: 'The target database URL is not a valid URL.' };
  }
  if (!parsedUrl.protocol.startsWith('postgres')) {
    return { ok: false, error: `Expected a postgresql:// URL, got "${parsedUrl.protocol}".` };
  }

  const emailResult = emailSchema.safeParse(values.email);
  if (!emailResult.success) {
    return { ok: false, error: '--email is required and must be a valid email address.' };
  }

  let businessId: string | undefined;
  if (values['business-id'] !== undefined) {
    const trimmed = values['business-id'].trim();
    if (trimmed.length === 0) {
      return { ok: false, error: '--business-id, if given, must not be empty.' };
    }
    businessId = trimmed;
  }

  let continueUrl: string | undefined;
  if (values['continue-url'] !== undefined) {
    const continueUrlResult = urlSchema.safeParse(values['continue-url']);
    if (!continueUrlResult.success) {
      return { ok: false, error: '--continue-url must be a valid URL.' };
    }
    continueUrl = continueUrlResult.data;
  }

  return {
    ok: true,
    config: {
      databaseUrl,
      email: emailResult.data,
      businessId,
      continueUrl,
      confirmed: values.yes === true,
    },
  };
}

/** Host/port/database name only — never the username or password. Safe to print or log. */
export function describeDatabaseTarget(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  return `${url.hostname}:${url.port || '5432'}${url.pathname}`;
}
