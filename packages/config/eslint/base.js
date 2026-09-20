import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

/**
 * Shared flat ESLint config.
 *
 * The rules below are not style preferences — each one blocks a specific
 * failure mode documented in /docs. See the comment on each rule.
 */
export const baseConfig = [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    ignores: ['dist/**', '.next/**', 'build/**', 'coverage/**', 'node_modules/**', '.turbo/**'],
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'prefer-const': 'error',
      'no-var': 'error',

      // Money must never be a float (BR-P9, ADR-006). parseFloat on a money
      // value is the classic way this rule gets broken.
      'no-restricted-globals': [
        'error',
        {
          name: 'parseFloat',
          message: 'Money is integer paise. See docs/04-DATABASE-DESIGN.md 1.2.',
        },
      ],

      // Date arithmetic must go through packages/core time helpers so that
      // Asia/Kolkata handling stays in one place (ADR-007).
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message:
            'Use now() from @healthy-aahar/core instead of new Date() so time is testable and timezone-correct (ADR-007).',
        },
      ],
    },
  },
];

export default baseConfig;
