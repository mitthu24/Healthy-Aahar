#!/usr/bin/env node
/**
 * Run a command with the repository-root `.env` loaded, if one exists.
 *
 * Why this exists rather than `dotenv -e ../../.env --`:
 *
 *   - **Local:** a root `.env` is the single source of truth, and Prisma/tsx
 *     run from inside `packages/db` or `apps/api` where they would not find it.
 *   - **CI and Railway:** there is no `.env` file at all — configuration comes
 *     from real environment variables. `dotenv-cli` treats a missing file as a
 *     fatal error, which would break every deploy.
 *
 * So: load the file when present, ignore it when absent, and never override a
 * variable that is already set. Platform configuration always wins over a
 * stray file (docs/27-ENVIRONMENT-CONFIGURATION.md §1).
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = resolve(repoRoot, '.env');

function parseEnvFile(contents) {
  const result = {};

  for (const rawLine of contents.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();

    // Strip surrounding quotes, then any trailing ` # comment` on an
    // unquoted value (our .env.example annotates values this way).
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));

    if (quoted) {
      value = value.slice(1, -1);
    } else {
      const hash = value.indexOf(' #');
      if (hash !== -1) value = value.slice(0, hash).trim();
    }

    result[key] = value;
  }

  return result;
}

if (existsSync(envPath)) {
  const parsed = parseEnvFile(readFileSync(envPath, 'utf8'));
  for (const [key, value] of Object.entries(parsed)) {
    // Never override: a real environment variable always wins.
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

const [command, ...args] = process.argv.slice(2);

if (!command) {
  console.error('Usage: node scripts/with-env.mjs <command> [...args]');
  process.exit(1);
}

const child = spawn(command, args, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: process.env,
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
