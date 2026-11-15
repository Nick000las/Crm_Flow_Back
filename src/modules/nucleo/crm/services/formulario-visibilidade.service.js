import { PAPEIS_GESTAO } from '../constants.js';
import { obterSchemaCampos } from './field-schema.service.js';
import { obterSchemaDoPapel } from './permissoes.service.js';

/**
 * Quem vê o quê de um formulário respondido (FM4 e FM5), a mesma regra para
 * "Ver respostas" e para os alertas:
 *
 * - gestão vê tudo;
 * - campo do CRM: quem o tem no schema do seu papel (o sensível já sai oculto
 *   para o OPERADOR, `permissoes.service.js`). Campo que saiu do CRM depois da
 *   publicação vale pela marca de sensível da versão;
 * - pergunta própria sensível: só gestão (não há permissão por pergunta).
 *
 * @param {string} tenantId
 * @param {string | undefined} papel
 */
export async function regraDeVisibilidade(tenantId, papel) {
  const gestao = PAPEIS_GESTAO.includes(/** @type {any} */ (papel));
  const [doPapel, todos] = await Promise.all([
    obterSchemaDoPapel(tenantId, papel),
    obterSchemaCampos(tenantId),
  ]);
  const visiveis = new Set(doPapel.campos.map((campo) => campo.id));
  const existentes = new Set(todos.campos.map((campo) => campo.id));
  return {
    gestao,
    /** @param {string} campoId @param {{ sensivel?: boolean } | undefined} retrato */
    veCampo: (campoId, retrato) =>
      gestao || visiveis.has(campoId) || (!existentes.has(campoId) && !retrato?.sensivel),
    /** @param {boolean | undefined} sensivel */
    vePergunta: (sensivel) => gestao || !sensivel,
  };
}
