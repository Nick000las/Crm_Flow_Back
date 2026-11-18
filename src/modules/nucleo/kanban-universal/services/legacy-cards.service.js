/**
 * @file Executa os casos de uso de legacy cards, na área de Kanban; coordena validação, regras
 * e operações dos adapters.
 */
import { executar } from './native-kanban.service.js';

// Compatibilidade para consumidores antigos, usando a mesma transação validada.
export function moverCard(context, cardId, novaColunaId) {
  return executar(context.tenantId, 'card.move', cardId, { novaColunaId, novaOrdem: 0 }, context);
}

export function buscarCardsPorBoard(context, boardId) {
  return executar(context.tenantId, 'card.list', boardId, {}, context);
}
