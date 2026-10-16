/**
 * Resolver de import do ESLint para os subpath imports do Node (`#core/*`,
 * `#modules/*`, ... — campo `imports` do package.json).
 *
 * O `eslint-plugin-boundaries` só sabe a que elemento (core, module, api…)
 * um import pertence se conseguir resolver o caminho do arquivo. O resolver
 * padrão (node) não entende `#…`, e aí a regra de fronteira deixava passar
 * qualquer import por alias — justamente o único tipo permitido no projeto.
 *
 * CommonJS de propósito: `eslint-module-utils` carrega resolvers com
 * `require`. Interface v2: https://github.com/import-js/eslint-plugin-import/blob/main/resolvers/README.md
 */
const fs = require('node:fs');
const path = require('node:path');

const raiz = __dirname;
const { imports = {} } = JSON.parse(fs.readFileSync(path.join(raiz, 'package.json'), 'utf8'));

/** `[prefixo, destino]`, ex: `['#core/', './src/core/']` — só padrões com `*`. */
const mapeamentos = Object.entries(imports)
  .filter(([padrao, destino]) => padrao.endsWith('*') && typeof destino === 'string' && destino.endsWith('*'))
  .map(([padrao, destino]) => [padrao.slice(0, -1), destino.slice(0, -1)]);

exports.interfaceVersion = 2;

/**
 * @param {string} source
 * @returns {{ found: boolean, path?: string | null }}
 */
exports.resolve = function resolve(source) {
  if (!source.startsWith('#')) return { found: false };

  for (const [prefixo, destino] of mapeamentos) {
    if (!source.startsWith(prefixo)) continue;
    const arquivo = path.resolve(raiz, destino + source.slice(prefixo.length));
    return fs.existsSync(arquivo) ? { found: true, path: arquivo } : { found: false };
  }
  return { found: false };
};
