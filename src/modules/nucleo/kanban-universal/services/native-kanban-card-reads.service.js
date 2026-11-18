/**
 * @file Apresenta cards, histórico e arquivo a partir do snapshot autorizado do quadro.
 * @layer service
 */
import * as queries from '../adapters/kanban.repository.js';
import { present } from './native-kanban-state.service.js';

export async function activityListOperation(operation) {
  const { requireCard, tx, tenantId, id } = operation;

  requireCard();

  return await queries.listCardActivities(tx, { tenantId, cardId: id });
}

export async function archiveListOperation(operation) {
  const { requireBoard, allCards, id } = operation;

  requireBoard();

  return allCards.filter((item) => item.board_id === id && item.archived_at).map(present);
}

export async function cardListOperation(operation) {
  const { requireBoard, cards, id } = operation;

  requireBoard();

  return cards.filter((c) => c.board_id === id).map(present);
}

export async function cardGetOperation(operation) {
  const { requireCard, withDependencies, card } = operation;

  requireCard();

  return withDependencies(card);
}
