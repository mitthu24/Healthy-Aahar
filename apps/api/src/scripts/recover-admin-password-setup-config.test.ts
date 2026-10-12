import { describe, expect, it } from 'vitest';

import {
  describeDatabaseTarget,
  resolveRecoveryConfig,
} from './recover-admin-password-setup-config.js';

const VALID_ARGS = [
  '--database-url',
  'postgresql://user:pass@db.example.test:5432/healthy_aahar',
  '--email',
  'admin@gmail.com',
  '--yes',
];

describe('resolveRecoveryConfig', () => {
  it('accepts a fully valid invocation', () => {
    const result = resolveRecoveryConfig(VALID_ARGS, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config).toMatchObject({
      databaseUrl: 'postgresql://user:pass@db.example.test:5432/healthy_aahar',
      email: 'admin@gmail.com',
      confirmed: true,
    });
  });

  it('defaults confirmed to false when --yes is omitted (dry run)', () => {
    const args = VALID_ARGS.filter((a) => a !== '--yes');
    const result = resolveRecoveryConfig(args, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.confirmed).toBe(false);
  });

  describe('database targeting — fail closed, never falls back to DATABASE_URL', () => {
    it('refuses when neither --database-url nor RECOVERY_DATABASE_URL is given', () => {
      const args = VALID_ARGS.filter(
        (a, i) => a !== '--database-url' && VALID_ARGS[i - 1] !== '--database-url',
      );
      const result = resolveRecoveryConfig(args, {});
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatch(/No target database given/);
    });

    it('NEVER reads the ambient DATABASE_URL, even when it is set, if --database-url/RECOVERY_DATABASE_URL are absent', () => {
      const args = VALID_ARGS.filter(
        (a, i) => a !== '--database-url' && VALID_ARGS[i - 1] !== '--database-url',
      );
      const result = resolveRecoveryConfig(args, {
        DATABASE_URL: 'postgresql://prod_user:prod_pass@prod-host:5432/prod_db',
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatch(/No target database given/);
    });

    it('accepts RECOVERY_DATABASE_URL (the explicit, differently-named env var) as a fallback for --database-url', () => {
      const args = VALID_ARGS.filter(
        (a, i) => a !== '--database-url' && VALID_ARGS[i - 1] !== '--database-url',
      );
      const result = resolveRecoveryConfig(args, {
        RECOVERY_DATABASE_URL: 'postgresql://user:pass@explicit-host:5432/db',
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.databaseUrl).toBe('postgresql://user:pass@explicit-host:5432/db');
    });

    it('rejects a non-postgres URL', () => {
      const args = [...VALID_ARGS];
      const idx = args.indexOf('--database-url');
      args[idx + 1] = 'mysql://user:pass@host:3306/db';
      const result = resolveRecoveryConfig(args, {});
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatch(/Expected a postgresql:\/\/ URL/);
    });

    it('rejects a malformed URL', () => {
      const args = [...VALID_ARGS];
      const idx = args.indexOf('--database-url');
      args[idx + 1] = 'not-a-url';
      const result = resolveRecoveryConfig(args, {});
      expect(result.ok).toBe(false);
    });
  });

  describe('CI refusal — never print a one-time secret into a retained log', () => {
    it('refuses when CI=true', () => {
      const result = resolveRecoveryConfig(VALID_ARGS, { CI: 'true' });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatch(/Refusing to run under CI/);
    });

    it('refuses when GITHUB_ACTIONS=true', () => {
      const result = resolveRecoveryConfig(VALID_ARGS, { GITHUB_ACTIONS: 'true' });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatch(/Refusing to run under CI/);
    });

    it('does not refuse when CI/GITHUB_ACTIONS are unset', () => {
      const result = resolveRecoveryConfig(VALID_ARGS, {});
      expect(result.ok).toBe(true);
    });
  });

  describe('required fields', () => {
    it('rejects a missing --email', () => {
      const args = VALID_ARGS.filter((a, i) => a !== '--email' && VALID_ARGS[i - 1] !== '--email');
      const result = resolveRecoveryConfig(args, {});
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatch(/--email/);
    });

    it('rejects an invalid --email', () => {
      const args = [...VALID_ARGS];
      const idx = args.indexOf('--email');
      args[idx + 1] = 'not-an-email';
      const result = resolveRecoveryConfig(args, {});
      expect(result.ok).toBe(false);
    });

    it('rejects an invalid --continue-url', () => {
      const result = resolveRecoveryConfig([...VALID_ARGS, '--continue-url', 'not-a-url'], {});
      expect(result.ok).toBe(false);
    });

    it('accepts a valid --continue-url', () => {
      const result = resolveRecoveryConfig(
        [...VALID_ARGS, '--continue-url', 'https://admin.example.test/password-setup'],
        {},
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.continueUrl).toBe('https://admin.example.test/password-setup');
    });

    it('rejects an unknown flag', () => {
      const result = resolveRecoveryConfig([...VALID_ARGS, '--totally-unknown-flag'], {});
      expect(result.ok).toBe(false);
    });
  });
});

describe('describeDatabaseTarget', () => {
  it('returns only host/port/database name — never the username or password', () => {
    const described = describeDatabaseTarget(
      'postgresql://super_secret_user:super_secret_pass@db.example.test:5432/healthy_aahar',
    );
    expect(described).toBe('db.example.test:5432/healthy_aahar');
    expect(described).not.toMatch(/super_secret/);
  });

  it('defaults the port to 5432 when absent from the URL', () => {
    expect(describeDatabaseTarget('postgresql://user:pass@db.example.test/healthy_aahar')).toBe(
      'db.example.test:5432/healthy_aahar',
    );
  });
});
