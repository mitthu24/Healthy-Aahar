/**
 * Conventional Commits — docs/26-GITHUB-WORKFLOW.md section 3.
 * Enforced in a pre-commit hook and in CI.
 */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [
      2,
      'always',
      [
        'api',
        'customer',
        'admin',
        'marketing',
        'worker',
        'core',
        'db',
        'ui',
        'auth',
        'contracts',
        'config',
        'notifications',
        'payments',
        'storage',
        'observability',
        'sdk',
        'docs',
        'ci',
        'infra',
        'deps',
        'repo',
      ],
    ],
    'body-max-line-length': [1, 'always', 100],
  },
};
