/** Regras de legibilidade comuns ao backend e ao frontend. */
export default {
  rules: {
    curly: ['error', 'all'],
    eqeqeq: ['error', 'always'],
    'no-var': 'error',
    'prefer-const': 'error',
    'no-duplicate-imports': 'error',
    'max-statements-per-line': ['error', { max: 1 }],
  },
};
