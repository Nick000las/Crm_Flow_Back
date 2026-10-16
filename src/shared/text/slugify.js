const COMBINING_DIACRITICS_RANGE = /[̀-ͯ]/g;
const SPACE_OR_HYPHEN_RUN = /[\s-]+/g;
const NON_SLUG_CHAR = /[^a-z0-9_]/g;
const REPEATED_UNDERSCORE = /_+/g;
const EDGE_UNDERSCORE = /^_+|_+$/g;

/**
 * Gera um slug estável a partir de texto livre — usado hoje pra derivar
 * `chave` de campo personalizado a partir do `label` (plano de campos
 * customizados, Parte 1.3). Fica em `shared/` porque é utilitário
 * genérico, não específico de CRM.
 *
 * Minúsculo, sem acento (`normalize('NFD')` separa a letra da marca
 * diacrítica, que aí vira removível por regex), espaço/hífen viram `_`,
 * qualquer outro caractere fora de `[a-z0-9_]` é removido, `_` repetido
 * colapsa em um só.
 *
 * @param {string} texto
 * @returns {string}
 */
export function slugify(texto) {
  return texto
    .normalize('NFD')
    .replace(COMBINING_DIACRITICS_RANGE, '')
    .toLowerCase()
    .trim()
    .replace(SPACE_OR_HYPHEN_RUN, '_')
    .replace(NON_SLUG_CHAR, '')
    .replace(REPEATED_UNDERSCORE, '_')
    .replace(EDGE_UNDERSCORE, '');
}
