import { getTenantClient } from '#core/db/tenantClient.js';

/**
 * ADAPTER: único lugar deste módulo que chama getTenantClient.
 * @typedef {import('../types/index.js').Card} Card
 */

/**
 * @param {string} tenantId
 * @param {string} cardId
 * @param {string} novaColunaId
 * @returns {Promise<void>}
 */
export function moverCard(tenantId, cardId, novaColunaId) {
  return getTenantClient(tenantId, async (tx) => {
    await tx.$executeRaw`
      UPDATE modulo_kanban_universal.cards
      SET coluna_id = ${novaColunaId}::uuid, updated_at = now()
      WHERE id = ${cardId}::uuid AND tenant_id = ${tenantId}::uuid
    `;
  });
}

/**
 * @param {string} tenantId
 * @param {string} boardId
 * @returns {Promise<Card[]>}
 */
export function buscarCardsPorBoard(tenantId, boardId) {
  return getTenantClient(
    tenantId,
    (tx) => tx.$queryRaw`
      SELECT id, board_id, coluna_id, titulo, responsavel_id, dados_extras
      FROM modulo_kanban_universal.cards
      WHERE tenant_id = ${tenantId}::uuid AND board_id = ${boardId}::uuid
    `,
  );
}
