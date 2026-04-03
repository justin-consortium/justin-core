import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import importPlugin from 'eslint-plugin-import';
import unusedImports from 'eslint-plugin-unused-imports';

/** @type {import('eslint').Linter.FlatConfig[]} */
export default [
  {
    ignores: ['node_modules/**', 'dist/**', 'build/**', 'coverage/**'],
  },

  {
    files: ['src/**/*.{ts,tsx}'],

    languageOptions: {
      parser: tsParser,
      parserOptions: {
        sourceType: 'module',
        ecmaVersion: 2020,
        // Points at tsconfig.eslint.json which includes test files — the base
        // tsconfig.json excludes __tests__ dirs (correct for build output) but
        // ESLint needs them included for type-aware rules to work.
        project: './tsconfig.eslint.json',
      },
    },

    plugins: {
      '@typescript-eslint': tsPlugin,
      import: importPlugin,
      'unused-imports': unusedImports,
    },

    rules: {
      /*
       * Imports
       */
      // Replaced by @typescript-eslint/consistent-type-imports — keep off to avoid conflict
      'no-duplicate-imports': 'off',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],

      /*
       * Exports at bottom
       */
      'import/exports-last': 'error',

      /*
       * TypeScript — type safety
       */
      // Catches unawaited promises — critical for async manager and lifecycle code
      '@typescript-eslint/no-floating-promises': 'error',
      // Catches async functions passed where sync is expected (e.g. array callbacks)
      '@typescript-eslint/no-misused-promises': 'error',

      /*
       * Unused vars — handled by unused-imports plugin (covers both vars and imports)
       */
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'unused-imports/no-unused-imports': 'warn',
      'unused-imports/no-unused-vars': [
        'warn',
        { vars: 'all', varsIgnorePattern: '^_', argsIgnorePattern: '^_' },
      ],

      /*
       * Control-flow safety
       */
      'no-unreachable': 'error',
      'no-fallthrough': 'error',
      'default-case': 'warn',

      /*
       * General correctness
       */
      'eqeqeq': ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',

      /*
       * Catches accidental console.log left in source — use the logger instead
       */
      'no-console': 'warn',
    },
  },

  // Type declaration files — relax exports-last and type-imports enforcement
  {
    files: ['src/**/*.d.ts', 'src/**/*.type.ts'],
    rules: {
      'import/exports-last': 'off',
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },

  // Test files — relax no-console and inline export restriction
  {
    files: ['src/**/*.test.ts', 'src/**/*.spec.ts', 'src/**/__tests__/**/*.ts'],
    rules: {
      'no-console': 'off',
      'no-restricted-syntax': 'off',
    },
  },

  // Logger — console is the intended default transport, not an accidental debug statement
  {
    files: ['src/logger/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },

  // Flag inline `export const` declarations — these files need converting to the
  // declare-then-export pattern so that import/exports-last covers them uniformly.
  // Test files and testing helpers are excluded since inline exports are acceptable there.
  {
    files: ['src/**/*.ts'],
    ignores: [
      'src/**/*.test.ts',
      'src/**/*.spec.ts',
      'src/**/__tests__/**/*.ts',
      'src/testing/**/*.ts',
    ],
    rules: {
      'no-restricted-syntax': [
        'warn',
        {
          selector: 'ExportNamedDeclaration > VariableDeclaration',
          message:
            'Prefer the declare-then-export pattern. Declare the value without export, then add it to an export block at the bottom of the file.',
        },
      ],
    },
  },
];
