#!/usr/bin/env node
/**
 * Guard: no secret may carry the NEXT_PUBLIC_ prefix.
 *
 * Everything with that prefix is inlined into the client bundle at build time
 * and is therefore public, permanently and irrevocably. A leaked service-
 * account key or database URL cannot be un-shipped — it can only be rotated,
 * after it has already been distributed to every visitor.
 *
 * This runs in CI on every PR (BR-ENV5).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();

/** Substrings that must never appear in a NEXT_PUBLIC_ variable name. */
const FORBIDDEN_IN_PUBLIC = [
  'SECRET',
  'PRIVATE',
  'SERVICE_ACCOUNT',
  'PASSWORD',
  'DATABASE_URL',
  'CREDENTIAL',
  'INTERNAL_TOKEN',
  'WEBHOOK_SECRET',
  'BREVO_API_KEY',
  'R2_SECRET',
  'SENTRY_AUTH_TOKEN',
];

/**
 * Firebase web API keys are a known exception: they identify a project and
 * authorise nothing. Everything else matching the patterns above is a bug.
 */
const ALLOWED_EXCEPTIONS = new Set([
  'NEXT_PUBLIC_FIREBASE_API_KEY',
  'NEXT_PUBLIC_FIREBASE_ADMIN_API_KEY',
]);

const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'dist', '.turbo', 'coverage']);

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      yield* walk(full);
    } else if (entry === '.env.example' || entry.startsWith('.env.') || entry === '.env') {
      yield full;
    }
  }
}

const problems = [];

for (const file of walk(ROOT)) {
  const lines = readFileSync(file, 'utf8').split('\n');

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;

    const [rawName, ...rest] = trimmed.split('=');
    const name = rawName?.trim();
    if (!name?.startsWith('NEXT_PUBLIC_')) return;

    if (ALLOWED_EXCEPTIONS.has(name)) return;

    const offending = FORBIDDEN_IN_PUBLIC.find((needle) => name.includes(needle));
    if (offending) {
      problems.push(
        `${relative(ROOT, file)}:${index + 1} — ${name} looks like a secret ("${offending}") ` +
          'but carries the NEXT_PUBLIC_ prefix, which ships it to every browser.',
      );
    }

    // A committed example file must never contain a real value either.
    const value = rest.join('=').trim();
    if (file.endsWith('.env.example') && value.length > 60) {
      problems.push(
        `${relative(ROOT, file)}:${index + 1} — ${name} has a suspiciously long value in a ` +
          'committed example file. Example files carry placeholders, never real values.',
      );
    }
  });
}

if (problems.length > 0) {
  console.error('\nPublic environment check FAILED:\n');
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error('\nSee docs/27-ENVIRONMENT-CONFIGURATION.md §2 and BR-ENV5.\n');
  process.exit(1);
}

console.log('Public environment check passed: no secrets carry the NEXT_PUBLIC_ prefix.');
