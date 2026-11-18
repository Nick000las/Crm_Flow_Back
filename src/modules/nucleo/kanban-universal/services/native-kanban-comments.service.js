/**
 * @file Valida autoria e conteúdo das operações de comentários dos cards.
 * @layer service
 */
import { AppError } from '#core/errors/app-error.js';
import { HTTP_STATUS } from '#shared/constants/index.js';

import * as queries from '../adapters/kanban.repository.js';
import { fail, present } from './native-kanban-state.service.js';

export async function commentListOperation(operation) {
  const { requireCard, tx, tenantId, id } = operation;

  requireCard();

  return (await queries.listCardComments(tx, { tenantId, cardId: id })).map(present);
}

export async function commentCreateOperation(operation) {
  const { requireCard, tx, tenantId, id, context, data } = operation;

  requireCard();

  return present(
    (
      await queries.insertComment(tx, {
        tenantId,
        cardId: id,
        userId: context.userId,
        content: data.conteudo,
        mentionedIds: data.mencionados ?? [],
      })
    )[0],
  );
}

export async function commentDeleteOperation(operation) {
  const { tx, tenantId, id, action, context, resourceBoardId, data } = operation;

  const comment = (await queries.findComment(tx, { tenantId, commentId: id }))[0];

  if (!comment) {
    fail('Comentário não encontrado.');
  }

  if (
    (action === 'comment.update' || context.role === 'OPERADOR') &&
    comment.usuario_id !== context.userId
  ) {
    throw new AppError({
      code: 'FORBIDDEN',
      statusCode: HTTP_STATUS.FORBIDDEN,
      message: 'Você só pode excluir seus comentários.',
    });
  }

  if (action === 'comment.update') {
    await queries.insertCommentActivity(tx, {
      tenantId,
      boardId: resourceBoardId,
      cardId: comment.card_id,
      actorId: context.userId,
    });

    return present(
      (await queries.updateComment(tx, { content: data.conteudo, tenantId, commentId: id }))[0],
    );
  }

  await queries.deleteComment(tx, { tenantId, commentId: id });

  return null;
}
