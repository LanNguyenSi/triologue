import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import globals from 'globals';

// File set of the base lint script: eslint src --ext ts; the .js and .jsx
// patterns keep parity with the old config for runs from the repository root.
const lintedFiles = ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'];

export default defineConfig(
  {
    // mirrors the .eslintrc.json ignorePatterns; **/*.mjs is added because
    // the base lint script limited itself with --ext and never linted .mjs,
    // while flat config lints .mjs by default (this config file itself
    // included)
    ignores: [
      'node_modules/',
      'dist/',
      'build/',
      'coverage/',
      'backups/',
      '**/*.d.ts',
      '**/*.mjs',
    ],
  },
  js.configs.recommended,
  // typescript-eslint configs.eslintRecommended is scoped to TS files, which
  // matches the base eslintrc behaviour: its core-rule overrides never
  // applied to the .js files of this repository
  ...tseslint.configs.recommended,
  {
    files: lintedFiles,
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.es2022,
      },
    },
    rules: {
      'no-undef': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-empty-function': 'warn',
      '@typescript-eslint/ban-ts-comment': 'warn',
      '@typescript-eslint/no-require-imports': 'warn',
      '@typescript-eslint/no-var-requires': 'warn',
      'no-empty': 'warn',
      'no-constant-condition': 'warn',
      'no-useless-escape': 'warn',
      'no-case-declarations': 'warn',
      'no-prototype-builtins': 'warn',
      'no-control-regex': 'warn',
      '@typescript-eslint/no-namespace': 'warn',
      '@typescript-eslint/no-empty-object-type': 'warn',
    },
  },
);
