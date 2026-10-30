import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';
import globals from 'globals';

// File set of the base lint script: eslint . --ext ts,tsx
// Flat config is not inherited from the repository root, so this file
// reproduces the root config the old client/.eslintrc.json extended and
// adds the react-hooks rule that file used to set.
const lintedFiles = ['**/*.ts', '**/*.tsx'];

export default defineConfig(
  {
    // mirrors the root .eslintrc.json ignorePatterns, relative to client/;
    // **/*.mjs is added because the base lint script limited itself with
    // --ext and never linted .mjs, while flat config lints .mjs by default
    // (this config file itself included)
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
  ...tseslint.configs.recommended,
  {
    files: lintedFiles,
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.browser,
        ...globals.es2022,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      'no-undef': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'warn',
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
      'react-hooks/rules-of-hooks': 'error',
    },
  },
);
