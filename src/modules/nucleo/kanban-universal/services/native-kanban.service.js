/**
 * @file Coordena transação, snapshot, autorização e despacho dos casos de uso nativos do
 * Kanban.
 * @layer service
 */
import * as queries from '../adapters/kanban.repository.js';
import { ACOES_DE_LEITURA } from '../constants.js';
import { exigirParticipacao, listarParticipantes } from './board-members.service.js';
import { cardBatchOperation } from './native-kanban-batch.service.js';
import {
  boardCreateOperation,
  boardDeleteOperation,
  boardGetOperation,
  boardMembersOperation,
  boardMembersUpdateOperation,
  boardUpdateOperation,
  membersOperation,
} from './native-kanban-boards.service.js';
import {
  cardCreateOperation,
  cardDuplicateOperation,
  cardFollowOperation,
  cardLinkOperation,
  cardUpdateOperation,
} from './native-kanban-card-details.service.js';
import {
  cardArchiveOperation,
  cardDeleteOperation,
  cardMoveOperation,
} from './native-kanban-card-movement.service.js';
import {
  activityListOperation,
  archiveListOperation,
  cardGetOperation,
  cardListOperation,
} from './native-kanban-card-reads.service.js';
import {
  columnCreateOperation,
  columnDeleteOperation,
  columnReorderOperation,
  columnUpdateOperation,
} from './native-kanban-columns.service.js';
import {
  commentCreateOperation,
  commentDeleteOperation,
  commentListOperation,
} from './native-kanban-comments.service.js';
import { metricsGetOperation, reportGetOperation } from './native-kanban-reports.service.js';
import { createNativeKanbanRules } from './native-kanban-rules.service.js';
import { comVinculo, fail } from './native-kanban-state.service.js';

const OPERATIONS = {
  'board.get': boardGetOperation,
  'metrics.get': metricsGetOperation,
  'report.get': reportGetOperation,
  'activity.list': activityListOperation,
  'archive.list': archiveListOperation,
  'card.archive': cardArchiveOperation,
  'card.restore': cardArchiveOperation,
  'board.members': boardMembersOperation,
  'board.members.update': boardMembersUpdateOperation,
  'board.create': boardCreateOperation,
  'board.update': boardUpdateOperation,
  'board.delete': boardDeleteOperation,
  'column.create': columnCreateOperation,
  'column.update': columnUpdateOperation,
  'column.reorder': columnReorderOperation,
  'column.delete': columnDeleteOperation,
  'card.list': cardListOperation,
  'card.get': cardGetOperation,
  'card.link': cardLinkOperation,
  'card.batch': cardBatchOperation,
  'card.create': cardCreateOperation,
  'card.follow': cardFollowOperation,
  'card.duplicate': cardDuplicateOperation,
  'card.update': cardUpdateOperation,
  'card.move': cardMoveOperation,
  'card.delete': cardDeleteOperation,
  'comment.list': commentListOperation,
  'comment.create': commentCreateOperation,
  'comment.delete': commentDeleteOperation,
  'comment.update': commentDeleteOperation,
  members: membersOperation,
};

/**
 * O quadro de que o recurso (quadro, coluna, card ou comentário) faz parte.
 * Consulta só os ids: card e coluna nunca mudam de quadro, então o resultado
 * continua válido depois de esperar o lock.
 */
async function resolverQuadro(tx, tenantId, action, id) {
  if (!id) {
    return {};
  }

  if (['comment.delete', 'comment.update'].includes(action)) {
    const [comment] = await queries.findCommentBoard(tx, { tenantId, commentId: id });

    return { boardId: comment?.board_id, cardId: comment?.card_id };
  }

  const [recurso] = await queries.findResourceBoards(tx, { tenantId, resourceId: id });

  return { boardId: recurso?.board_id };
}

/**
 * Estado de um quadro só. Colunas antes dos cards: sem lock (leitura), uma
 * coluna nova no meio das duas consultas no máximo deixa um card de fora até
 * o próximo evento, e a consulta de cards enxerga uma reordenação inteira ou
 * nada dela.
 */
async function carregarQuadro(tx, tenantId, boardId) {
  if (!boardId) {
    return { boards: [], columns: [], allCards: [] };
  }

  const boards = await queries.listSnapshotBoards(tx, { tenantId, boardId });
  const columns = await queries.listSnapshotColumns(tx, { tenantId, boardId });
  const allCards = await queries.listSnapshotCards(tx, { tenantId, boardId });

  return { boards, columns, allCards };
}

// Escritas no mesmo quadro são serializadas antes de ler o estado: o lock
// transacional protege inserções e reordenações. Quadros diferentes não
// disputam entre si, e leituras não pegam lock.
export function executar(tenantId, action, id, data = {}, context = {}, change, transaction) {
  return queries.withKanbanTransaction(
    tenantId,
    async (tx) => {
      const writing = !ACOES_DE_LEITURA.has(action);

      if (writing) {
        await queries.setAuditActor(tx, { actorId: context.userId ?? '' });
      }

      if (action === 'email.get') {
        const rows = await queries.findEmailPreference(tx, { tenantId, userId: context.userId });

        return { enabled: rows[0]?.enabled ?? true };
      }

      if (action === 'email.update') {
        await queries.saveEmailPreference(tx, {
          tenantId,
          userId: context.userId,
          enabled: data.enabled,
        });

        return { enabled: data.enabled };
      }

      // Resolve também recursos indiretos antes de autorizar (cards, colunas, comentários).
      const { boardId: resourceBoardId, cardId: commentCardId } = await resolverQuadro(
        tx,
        tenantId,
        action,
        id,
      );

      if (writing && resourceBoardId) {
        await queries.lockBoard(tx, { boardId: resourceBoardId });
      }

      // Depois do lock: uma revogação em andamento vale para esta escrita.
      if (resourceBoardId) {
        await exigirParticipacao(tx, tenantId, resourceBoardId, context, writing);
      }

      const { boards, columns, allCards } = await carregarQuadro(tx, tenantId, resourceBoardId);
      const cards = allCards.filter((item) => !item.archived_at);
      const board = boards.find((b) => b.id === id);
      const column = columns.find((c) => c.id === id);
      const card = allCards.find((c) => c.id === id);
      const withDependencies = (source) => ({
        ...comVinculo(source),
        dependenciasResolvidas: (Array.isArray(source.dados_extras?.dependencias)
          ? source.dados_extras.dependencias
          : []
        ).map((dependencyId) => {
          const dependency = allCards.find((item) => item.id === dependencyId);

          return dependency
            ? {
                id: dependency.id,
                titulo: dependency.titulo,
                archivedAt: dependency.archived_at,
                dadosExtras: { prazoConcluido: dependency.dados_extras?.prazoConcluido === true },
              }
            : {
                id: dependencyId,
                titulo: 'Dependência indisponível',
                dadosExtras: { prazoConcluido: false },
              };
        }),
      });

      if (change && commentCardId) {
        change.cardId = commentCardId;
      }

      if (change && resourceBoardId) {
        change.boardId = resourceBoardId;
        change.cardId ??= card?.id;

        change.previousUserIds = (await listarParticipantes(tx, tenantId, resourceBoardId))
          .filter((user) => user.ativo)
          .map((user) => user.id);
      }

      if (card?.archived_at && writing && !['card.restore', 'card.delete'].includes(action)) {
        fail('Restaure o card antes de alterá-lo.', true);
      }

      const rules = createNativeKanbanRules({
        tenantId,
        id,
        data,
        context,
        tx,
        resourceBoardId,
        board,
        column,
        card,
        columns,
        cards,
        allCards,
      });

      const operation = OPERATIONS[action];

      if (!operation) {
        throw new Error('Operação Kanban desconhecida');
      }

      return operation({
        ...rules,
        action,
        tenantId,
        id,
        data,
        context,
        change,
        tx,
        resourceBoardId,
        board,
        boards,
        column,
        columns,
        card,
        cards,
        allCards,
        withDependencies,
        executar,
      });
    },
    transaction,
  );
}

/** Retorna os metadados apenas depois que o gateway confirmou a transação. */
export async function executarComEvento(tenantId, action, id, data, context) {
  const event = { tenantId, type: action, actorId: context.userId };
  const value = await executar(tenantId, action, id, data, context, event);

  if (['card.create', 'card.duplicate'].includes(action)) {
    event.cardId = value.id;
  }

  if (action === 'card.batch') {
    event.cardIds = data.cards.map((card) => card.id);
    event.batchAction = data.acao;
  }

  event.conflito = value?.conflito ?? false;

  return { value, event };
}
