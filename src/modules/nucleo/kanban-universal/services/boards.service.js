/**
 * @file Lista os boards visíveis no contexto do tenant autenticado. Com a flag
 * `kanban_universal.quadros_entidade`, soma os quadros publicados pelos provedores e marca cada
 * item com `modo`; desligada, a resposta é a de sempre, sem o campo.
 */
import { featureAtiva } from '#core/tenant/feature-flags.js';

import { buscarBoardsPorTenant } from '../adapters/boards.repository.js';
import { KANBAN_FEATURES, MODOS_QUADRO } from '../constants.js';
import { listarQuadrosDeEntidade } from './quadro-entidade.service.js';

/** @typedef {import('../types/index.js').Board} Board */

/**
 * Lista os boards visíveis no contexto do tenant autenticado. Com a flag
 * `kanban_universal.quadros_entidade`, soma os quadros publicados pelos
 * provedores e marca cada item com `modo`; desligada, a resposta é a de
 * sempre, sem o campo.
 *
 * @param {import('#core/types/module.js').TenantContext} context
 * @param {{ warn: (dados: object, mensagem: string) => void }} logger
 * @returns {Promise<(Board | object)[]>}
 */
export async function listarBoardsDoTenant(context, logger) {
  const nativos = await buscarBoardsPorTenant(context);

  if (!(await featureAtiva(context.tenantId, KANBAN_FEATURES.QUADROS_ENTIDADE))) {
    return nativos;
  }

  return [
    ...nativos.map((board) => ({ ...board, modo: MODOS_QUADRO.NATIVO })),
    ...(await listarQuadrosDeEntidade(context, logger)),
  ];
}
