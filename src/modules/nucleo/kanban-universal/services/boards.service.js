import { buscarBoardsPorTenant } from '../adapters/boards.repository.js';

/** @typedef {import('../types/index.js').Board} Board */

/**
 * Lista os boards visíveis no contexto do tenant autenticado.
 *
 * @param {import('#core/types/module.js').TenantContext} context
 * @returns {Promise<Board[]>}
 */
export function listarBoardsDoTenant(context) {
  return buscarBoardsPorTenant(context);
}
