import { executar } from './kanban.repository.js';
// Compatibilidade para consumidores antigos, usando a mesma transação validada.
export function moverCard(context, cardId, novaColunaId) {
  return executar(context.tenantId, 'card.move', cardId, { novaColunaId, novaOrdem: 0 }, context);
}
export function buscarCardsPorBoard(context, boardId) {
  return executar(context.tenantId, 'card.list', boardId, {}, context);
}
