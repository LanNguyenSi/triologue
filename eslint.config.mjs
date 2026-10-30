import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import globals from 'globals';

// Root runs lint TypeScript and JavaScript sources; client/ and server/ files
// are linted with the config in their own directory.
const lintedFiles = ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'];

export default defineConfig(
  {
    // ES module scripts (.mjs) and the .cjs/.mts/.cts variants, which flat
    // config or typescript-eslint would otherwise pick up, are not linted
    ignores: [
      'node_modules/',
      'dist/',
      'build/',
      'coverage/',
      'backups/',
      '**/*.d.ts',
      '**/*.mjs',
      '**/*.cjs',
      '**/*.mts',
      '**/*.cts',
    ],
  },
  js.configs.recommended,
  // typescript-eslint scopes its eslint-recommended overrides to TS files,
  // so .js files keep the plain core rules
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
    },
  },
);
