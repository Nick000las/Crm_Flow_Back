import { moverCard, buscarCardsPorBoard } from '../adapters/cards.repository.js';

/** @typedef {import('../types/index.js').Card} Card */

/**
 * @param {string} tenantId
 * @param {string} boardId
 * @returns {Promise<Card[]>}
 */
export async function listarCardsDoBoard(tenantId, boardId) {
  return buscarCardsPorBoard(tenantId, boardId);
}

/**
 * Resolução de conflito concorrente (last-write-wins + aviso via socket, Bloco 4.2)
 * acontece na camada de evento/socket que consome este service.
 *
 * @param {string} tenantId
 * @param {string} cardId
 * @param {string} novaColunaId
 * @returns {Promise<void>}
 */
export async function moverCardDeColuna(tenantId, cardId, novaColunaId) {
  await moverCard(tenantId, cardId, novaColunaId);
}
