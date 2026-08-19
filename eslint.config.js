import js from '@eslint/js';
import boundaries from 'eslint-plugin-boundaries';

/**
 * A fronteira entre módulos NÃO é física (não há workspaces) — é garantida aqui.
 * Ver `.claude/rules/multi-tenant.md` e MODULE_CONTRACT.md.
 */

const MSG_ALIAS =
  'Importe por alias (#core/*, #shared/*, #modules/*) em vez de caminho relativo que sai da pasta do módulo.';

/** Aliases do scaffold TypeScript antigo — o projeto usa subpath imports do Node. */
const MSG_ALIAS_LEGADO =
  'Alias legado do scaffold TypeScript. Use #core/*, #shared/*, #modules/* (campo "imports" do package.json).';

const PADROES_BASE = [
  { group: ['../../*'], message: MSG_ALIAS },
  { group: ['@core/*', '@shared/*', '@modules/*'], message: MSG_ALIAS_LEGADO },
];

const TENANT_CLIENT_PROIBIDO = {
  name: '#core/db/tenantClient.js',
  message: 'Acesso a dado só em `adapters/`. Ver MODULE_CONTRACT.md, seções 3-4.',
};

const FASTIFY_PROIBIDO = {
  name: 'fastify',
  message: 'Só `controllers/` e `#api/` conhecem Fastify. services/ e adapters/ são HTTP-agnósticos.',
};

/**
 * Em flat config, o último bloco que casa com o arquivo substitui a regra inteira —
 * por isso cada camada repete `PADROES_BASE` em vez de herdá-lo.
 *
 * @param {{ paths?: object[], patterns?: object[] }} extras
 */
function restringirImports({ paths = [], patterns = [] } = {}) {
  return ['error', { paths, patterns: [...PADROES_BASE, ...patterns] }];
}

export default [
  { ignores: ['node_modules/**', 'prisma/*.generated.sql', 'coverage/**'] },

  js.configs.recommended,

  {
    files: ['src/**/*.js', 'scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        process: 'readonly',
        console: 'readonly',
        URL: 'readonly',
        Intl: 'readonly',
      },
    },
    plugins: { boundaries },
    settings: {
      'boundaries/include': ['src/**/*.js'],
      'boundaries/elements': [
        { type: 'core', pattern: 'src/core/**' },
        { type: 'shared', pattern: 'src/shared/**' },
        { type: 'module', pattern: 'src/modules/*/*/**', capture: ['categoria', 'modulo'] },
        { type: 'api', pattern: 'src/api/**' },
      ],
    },
    rules: {
      // Regra 4 do contrato: nenhum módulo importa de outro módulo.
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          message: '${file.type} não pode importar de ${dependency.type}.',
          rules: [
            { from: 'core', allow: ['core', 'shared'] },
            { from: 'shared', allow: ['shared'] },
            {
              from: 'module',
              allow: [
                'core',
                'shared',
                ['module', { categoria: '${from.categoria}', modulo: '${from.modulo}' }],
              ],
            },
            { from: 'api', allow: ['core', 'shared', 'module'] },
          ],
        },
      ],
      // Regra 3: import relativo nunca sai da pasta do módulo.
      'no-restricted-imports': restringirImports(),
    },
  },

  // controller → service (nunca adapter, nunca banco).
  {
    files: ['src/modules/**/controllers/**/*.js'],
    rules: {
      'no-restricted-imports': restringirImports({
        paths: [TENANT_CLIENT_PROIBIDO],
        patterns: [
          {
            group: ['**/adapters/*'],
            message: 'Camadas só se chamam numa direção: controller → service → adapter.',
          },
        ],
      }),
    },
  },

  // service → adapter (lógica de negócio pura, sem HTTP e sem banco direto).
  {
    files: ['src/modules/**/services/**/*.js'],
    rules: {
      'no-restricted-imports': restringirImports({
        paths: [TENANT_CLIENT_PROIBIDO, FASTIFY_PROIBIDO],
      }),
    },
  },

  // adapter → banco, via gateway multi-tenant e mais nada.
  {
    files: ['src/modules/**/adapters/**/*.js'],
    rules: {
      'no-restricted-imports': restringirImports({ paths: [FASTIFY_PROIBIDO] }),
    },
  },

  {
    files: ['**/*.test.js'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly' } },
    rules: {
      'boundaries/element-types': 'off',
      'no-restricted-imports': 'off',
    },
  },

  // Configs na raiz (eslint/vitest/etc.) rodam direto no Node, fora de src/.
  {
    files: ['*.config.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { process: 'readonly', console: 'readonly', URL: 'readonly' },
    },
  },
];
