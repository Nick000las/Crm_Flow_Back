import { erroNaoEncontrado } from '#core/errors/app-error.js';
import { ROLES } from '#shared/constants/index.js';
import { buscarOportunidade } from '../adapters/crm-oportunidades.repository.js';
import { buscarPipelinesOcultos } from '../adapters/crm-pipelines.repository.js';
import { buscarPessoasVisiveis } from '../adapters/leads.repository.js';

/**
 * SERVICE: visibilidade por pipeline (D4). O dono define quais pipelines o
 * OPERADOR enxerga, e isso vale em todo o CRM: quadro, tabela, ficha, busca e
 * totais. DONO e MASTER veem tudo.
 *
 * A pessoa aparece se tiver ao menos uma oportunidade visível, ou nenhuma. Se a
 * principal estiver oculta, a leitura traz os campos comerciais nulos.
 */

/**
 * @param {string} tenantId
 * @param {string | undefined} papel  sem papel (job, chamada interna): nada oculto
 * @returns {Promise<string[]>} ids dos pipelines que este papel não vê
 */
export async function pipelinesOcultos(tenantId, papel) {
  if (papel !== ROLES.OPERADOR) return [];
  return buscarPipelinesOcultos(tenantId);
}

/**
 * @param {string} tenantId
 * @param {string[]} ids
 * @param {string | undefined} papel
 * @returns {Promise<Set<string>>}
 */
export async function pessoasVisiveis(tenantId, ids, papel) {
  const ocultos = await pipelinesOcultos(tenantId, papel);
  if (ocultos.length === 0) return new Set(ids);
  return new Set(await buscarPessoasVisiveis(tenantId, ids, ocultos));
}

/**
 * @param {string} tenantId
 * @param {string} leadId
 * @param {string | undefined} papel
 */
export async function garantirPessoaVisivel(tenantId, leadId, papel) {
  const visiveis = await pessoasVisiveis(tenantId, [leadId], papel);
  if (!visiveis.has(leadId)) throw erroNaoEncontrado('Lead não encontrado');
}

/**
 * @param {string} tenantId
 * @param {string} id
 * @param {string | undefined} papel
 */
export async function garantirOportunidadeVisivel(tenantId, id, papel) {
  const ocultos = await pipelinesOcultos(tenantId, papel);
  if (ocultos.length === 0) return;
  const deal = await buscarOportunidade(tenantId, id, { incluirExcluidas: true });
  if (deal && ocultos.includes(deal.pipeline_id)) {
    throw erroNaoEncontrado('Oportunidade não encontrada');
  }
}
