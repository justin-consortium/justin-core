import tsParser from '@typescript-eslint/parser';

export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'build/**',
      'coverage/**',
    ],
  },
  {
    files: ['src/**/*.{ts,tsx,js,jsx}'],

    languageOptions: {
      parser: tsParser,
      parserOptions: {
        sourceType: 'module',
        ecmaVersion: 2020,
      },
    },

    rules: {
      'no-duplicate-imports': 'error',
      'no-unreachable': 'error',   // code after return/throw/etc.
      'no-fallthrough': 'error',  // fall-through between switch cases
      'default-case': 'warn',     // nudge for a default in switch
    },
  },
];
