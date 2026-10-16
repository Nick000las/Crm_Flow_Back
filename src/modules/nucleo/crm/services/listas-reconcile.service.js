import {
  buscarOpcoesDoTenant,
  buscarTagsDosLeads,
  inserirOpcoes,
  tenantTemLeads,
} from '../adapters/crm-options.repository.js';
import { LISTAS_SEMEADAS, OPCOES_LEGADAS, OPCOES_SUGERIDAS, TIPOS_LISTA } from '../constants.js';

/**
 * Reconciliação das listas (docs/crm/plano-configuracoes.md, M3.2):
 * garante que o tenant tem as listas semeadas e que toda tag já usada num
 * lead existe como opção. Idempotente — opção existente nunca é tocada.
 *
 * Lista semeada só uma vez: se o tenant já tem qualquer opção daquele
 * `kind`, nada entra (a última opção de uma lista semeada não pode ser
 * excluída, então "vazia" só acontece antes do primeiro seed).
 *
 * - Tenant com lead: as keys antigas (as que os CHECKs aceitavam) — os
 *   leads existentes continuam válidos sem nenhum UPDATE.
 * - Tenant sem lead: os padrões sugeridos pela spec.
 * - Tags: cada texto já gravado vira opção com key = label = o texto.
 */

/**
 * @param {string} tenantId
 * @returns {Promise<{ criadas: number }>}
 */
export async function reconciliarListas(tenantId) {
  const [existentes, temLeads, tagsDosLeads] = await Promise.all([
    buscarOpcoesDoTenant(tenantId),
    tenantTemLeads(tenantId),
    buscarTagsDosLeads(tenantId),
  ]);
  const kindsExistentes = new Set(existentes.map((opcao) => opcao.kind));

  let criadas = 0;
  for (const kind of LISTAS_SEMEADAS) {
    if (kindsExistentes.has(kind)) continue;
    const padrao = (temLeads && OPCOES_LEGADAS[kind]) || OPCOES_SUGERIDAS[kind];
    const inseridas = await inserirOpcoes(
      tenantId,
      kind,
      padrao.map((opcao, indice) => ({ ...opcao, position: indice })),
    );
    criadas += inseridas.length;
  }

  const tagsExistentes = new Set(
    existentes.filter((opcao) => opcao.kind === TIPOS_LISTA.TAG).map((opcao) => opcao.key),
  );
  const tagsNovas = tagsDosLeads.filter((tag) => !tagsExistentes.has(tag));
  const posicaoInicial = tagsExistentes.size;
  const inseridas = await inserirOpcoes(
    tenantId,
    TIPOS_LISTA.TAG,
    tagsNovas.map((tag, indice) => ({ key: tag, label: tag, position: posicaoInicial + indice })),
  );
  criadas += inseridas.length;

  return { criadas };
}

/** @type {import('./reconcile.service.js').PassoReconciliacao[]} */
export const PASSOS_LISTAS = Object.freeze([{ nome: 'listas-padrao', executar: reconciliarListas }]);
