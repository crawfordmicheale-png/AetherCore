import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', 'dist/', 'out/'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always'],
    },
  },
  // Headless game logic: no DOM, no Node APIs. Keeps src/game runnable everywhere.
  {
    files: ['src/game/**/*.js'],
    // Only APIs available in both browsers and Node.
    languageOptions: { globals: { structuredClone: 'readonly' } },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '**/render/**',
                '**/ui/**',
                '**/scenes/**',
                '**/input/**',
                '**/audio/**',
                '**/platform/**',
                'node:*',
              ],
              message: 'src/game must stay headless (see docs/TECHNICAL_DESIGN.md §2).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/**/*.js'],
    ignores: ['src/game/**'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ['electron/**/*.js', 'electron/**/*.cjs', 'tools/**/*.js', 'tests/**/*.js', '*.js'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs' },
  },
];
