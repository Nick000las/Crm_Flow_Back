import { AppError } from '#core/errors/app-error.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { ERROR_CODES } from '#shared/http/error-codes.js';
import {
  buscarViewsDoUsuario,
  buscarViewPorNome,
  criarView as criarViewRepository,
  removerView as removerViewRepository,
} from '../adapters/filter-views.repository.js';
import { listarCamposDoTenant } from './leads.service.js';
import { montarCondicoes } from './lead-filter.service.js';
import { CONTEXTOS_VISIBILIDADE } from '../constants.js';

/**
 * SERVICE: views de filtro salvas (docs/crm/plano-campos-filtros-import-export.md §2.5).
 * Aplicar uma view é o frontend reenviar `filtros` pra POST /crm/leads/search
 * — o filtro é revalidado ali contra os campos vigentes, já que um campo
 * pode ter sido desligado/removido depois da view salva.
 *
 * @typedef {import('../types/index.js').FilterView} FilterView
 */

/**
 * @param {string} tenantId
 * @param {string} usuarioId
 * @returns {Promise<FilterView[]>}
 */
export function listarViews(tenantId, usuarioId) {
  return buscarViewsDoUsuario(tenantId, usuarioId);
}

/**
 * @param {string} tenantId
 * @param {string} usuarioId
 * @param {{ nome: string, filtros: import('./lead-filter.service.js').FiltroLeads }} input
 * @returns {Promise<FilterView>}
 */
export async function salvarView(tenantId, usuarioId, { nome, filtros }) {
  // Valida contra os campos ativos agora, pra não salvar uma view que já
  // nasce quebrada (chave inexistente, operador incompatível).
  // Só campo visível no contexto `filter` (M2) — o mesmo critério da busca.
  montarCondicoes(filtros, await listarCamposDoTenant(tenantId, CONTEXTOS_VISIBILIDADE.FILTRO));

  if (await buscarViewPorNome(tenantId, usuarioId, nome)) {
    throw new AppError({
      statusCode: HTTP_STATUS.CONFLICT,
      code: ERROR_CODES.RESOURCE_CONFLICT,
      message: 'Você já tem uma view com esse nome',
      fields: { nome: ['Você já tem uma view com esse nome'] },
    });
  }

  return criarViewRepository(tenantId, usuarioId, { nome, filtros });
}

/**
 * @param {string} tenantId
 * @param {string} usuarioId
 * @param {string} viewId
 * @returns {Promise<{ removido: true }>}
 */
export async function excluirView(tenantId, usuarioId, viewId) {
  const removida = await removerViewRepository(tenantId, usuarioId, viewId);

  if (!removida) {
    throw new AppError({
      statusCode: HTTP_STATUS.NOT_FOUND,
      code: ERROR_CODES.RESOURCE_NOT_FOUND,
      message: 'View não encontrada',
    });
  }

  return { removido: true };
}
