// eslint.config.mjs
// @ts-check

import tsParser from '@typescript-eslint/parser';
import importPlugin from 'eslint-plugin-import';

/** @type {import('eslint').Linter.FlatConfig[]} */
export default [
  // 1) Global ignores
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'build/**',
      'coverage/**',
    ],
  },

  // 2) Main rules for src
  {
    files: ['src/**/*.{ts,tsx,js,jsx}'],

    languageOptions: {
      parser: tsParser,
      parserOptions: {
        sourceType: 'module',
        ecmaVersion: 2020,
      },
    },

    plugins: {
      import: importPlugin,
    },

    rules: {
      /*
       * Imports
       */
      'no-duplicate-imports': 'error',

      /*
       * Control-flow safety
       */
      'no-unreachable': 'error',
      'no-fallthrough': 'error',
      'default-case': 'warn',

      /*
       * Exports must be last in the file
       */
      'import/exports-last': 'error',
    },
  },

  // 3) Typing files: relax exports-last
  {
    files: [
      'src/**/*.d.ts',
      'src/**/*.type.ts', // tweak/extend this pattern if you use something else
    ],

    rules: {
      'import/exports-last': 'off',
    },
  },
];
