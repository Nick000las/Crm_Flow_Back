import { moverCard, buscarCardsPorBoard } from '../adapters/cards.repository.js';

/** @typedef {import('../types/index.js').Card} Card */

/**
 * @param {import('#core/types/module.js').TenantContext} context
 * @param {string} boardId
 * @returns {Promise<Card[]>}
 */
export async function listarCardsDoBoard(context, boardId) {
  return buscarCardsPorBoard(context, boardId);
}

/**
 * Resolução de conflito concorrente (last-write-wins + aviso via socket, Bloco 4.2)
 * acontece na camada de evento/socket que consome este service.
 *
 * @param {import('#core/types/module.js').TenantContext} context
 * @param {string} cardId
 * @param {string} novaColunaId
 * @returns {Promise<void>}
 */
export async function moverCardDeColuna(context, cardId, novaColunaId) {
  await moverCard(context, cardId, novaColunaId);
}
