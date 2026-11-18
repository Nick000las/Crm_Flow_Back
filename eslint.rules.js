/** @file Regras de legibilidade e organização aplicadas a JavaScript e JSX. */
import stylistic from '@stylistic/eslint-plugin';
import simpleImportSort from 'eslint-plugin-simple-import-sort';

import project from './tooling/eslint/index.js';

export default {
  plugins: { project, '@stylistic': stylistic, 'simple-import-sort': simpleImportSort },
  rules: {
    'project/imports-first': 'error',
    curly: ['error', 'all'],
    eqeqeq: ['error', 'always'],
    'no-var': 'error',
    'prefer-const': 'error',
    'no-duplicate-imports': 'error',
    'max-statements-per-line': ['error', { max: 1 }],
    'object-shorthand': ['error', 'always'],
    'no-unneeded-ternary': 'error',
    'no-else-return': ['error', { allowElseIf: true }],
    'simple-import-sort/imports': [
      'error',
      { groups: [['^\\u0000'], ['^node:'], ['^react(?:$|/)', '^@?\\w'], ['^#', '^@/'], ['^\\.']] },
    ],
    'simple-import-sort/exports': 'error',
    '@stylistic/padding-line-between-statements': [
      'error',
      { blankLine: 'always', prev: 'import', next: '*' },
      { blankLine: 'any', prev: 'import', next: 'import' },
      {
        blankLine: 'always',
        prev: '*',
        next: ['return', 'throw', 'if', 'for', 'while', 'switch', 'try', 'function', 'class'],
      },
      { blankLine: 'always', prev: 'block-like', next: '*' },
      { blankLine: 'always', prev: ['const', 'let'], next: '*' },
      { blankLine: 'always', prev: '*', next: ['const', 'let'] },
      { blankLine: 'any', prev: ['const', 'let'], next: ['const', 'let'] },
      { blankLine: 'always', prev: 'multiline-expression', next: '*' },
      { blankLine: 'always', prev: '*', next: 'multiline-expression' },
    ],
  },
};
