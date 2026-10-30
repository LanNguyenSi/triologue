import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';
import globals from 'globals';

// The client lints its TypeScript sources only. Flat config is not inherited
// from the repository root, so this file carries the root rules itself plus
// react-hooks/rules-of-hooks.
const lintedFiles = ['**/*.ts', '**/*.tsx'];

export default defineConfig(
  {
    // JavaScript files (config files such as postcss.config.js included) and
    // the .mts/.cts variants are not linted in the client
    ignores: [
      'node_modules/',
      'dist/',
      'build/',
      'coverage/',
      'backups/',
      '**/*.d.ts',
      '**/*.mjs',
      '**/*.js',
      '**/*.jsx',
      '**/*.cjs',
      '**/*.mts',
      '**/*.cts',
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
      // ESLint 10 defaults checkLoops to allExceptWhileTrue; 'all' keeps
      // constant loops such as while (true) reported
      'no-constant-condition': ['warn', { checkLoops: 'all' }],
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
