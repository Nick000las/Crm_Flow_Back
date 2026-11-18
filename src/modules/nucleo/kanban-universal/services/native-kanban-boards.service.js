/**
 * @file Consulta e mantém quadros e sua equipe, validando o acesso automático do autor.
 * @layer service
 */
import { AppError } from '#core/errors/app-error.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { ERROR_CODES } from '#shared/http/error-codes.js';

import * as queries from '../adapters/kanban.repository.js';
import { PAPEIS_GESTAO_KANBAN } from '../constants.js';
import { listarParticipantes } from './board-members.service.js';
import { present } from './native-kanban-state.service.js';

export async function boardGetOperation(operation) {
  const { requireBoard, tx, tenantId, id, withDependencies, board, context, cards, columns } =
    operation;

  requireBoard();

  const participantes = await listarParticipantes(tx, tenantId, id);
  const counts = await queries.countBoardComments(tx, { tenantId, boardId: id });
  const presentCard = (row) => ({
    ...withDependencies(row),
    commentsCount: counts.find((item) => item.card_id === row.id)?.total ?? 0,
  });

  return {
    ...present(board),
    canEdit:
      PAPEIS_GESTAO_KANBAN.includes(context.role) ||
      participantes.find((member) => member.id === context.userId)?.permissao !== 'leitor',
    participantes,
    modelos: cards.filter((k) => k.board_id === id && k.dados_extras?.modelo).map(present),
    colunas: columns
      .filter((c) => c.board_id === id)
      .map((c) => ({
        ...present(c),
        cards: cards
          .filter((k) => k.coluna_id === c.id && !k.dados_extras?.modelo)
          .map(presentCard),
      })),
  };
}

export async function boardMembersOperation(operation) {
  const { requireBoard, tx, tenantId, id } = operation;

  requireBoard();

  return listarParticipantes(tx, tenantId, id);
}

export async function boardMembersUpdateOperation(operation) {
  const { requireBoard, saveTeamWithActor, id, data } = operation;

  requireBoard();

  return saveTeamWithActor(id, data.participantes, data.permissoes);
}

export async function boardCreateOperation(operation) {
  const { tx, tenantId, data, change, context, saveTeamWithActor } = operation;

  const created = (
    await queries.insertBoard(tx, { tenantId, name: data.nome, boardType: data.boardType })
  )[0];

  if (change) {
    change.boardId = created.id;
  }

  // O criador participa inicialmente, além da equipe escolhida.
  const ids = [...new Set([context.userId, ...(data.participantes ?? [])])];
  const participantes = await saveTeamWithActor(created.id, ids, data.permissoes);
  // Colunas e equipe usam a mesma transação: falha desfaz a criação inteira.
  const initialColumns = data.colunasIniciais ?? [];

  if (initialColumns.length) {
    await queries.insertInitialColumns(tx, {
      tenantId,
      boardId: created.id,
      names: initialColumns,
    });
  }

  return { ...present(created), participantes };
}

export async function boardUpdateOperation(operation) {
  const { requireBoard, tx, data, tenantId, id, saveTeamWithActor } = operation;

  requireBoard();

  const updated = (
    await queries.updateBoardName(tx, { name: data.nome, tenantId, boardId: id })
  )[0];
  const ids =
    data.participantes ??
    (await listarParticipantes(tx, tenantId, id))
      .filter((member) => member.ativo)
      .map((member) => member.id);
  const participantes = await saveTeamWithActor(id, ids, data.permissoes);

  return { ...present(updated), participantes };
}

export async function boardDeleteOperation(operation) {
  const { requireBoard, tx, tenantId, id } = operation;

  requireBoard();
  await queries.deleteBoardCards(tx, { tenantId, boardId: id });
  await queries.deleteBoard(tx, { tenantId, boardId: id });

  return null;
}

export async function membersOperation(operation) {
  const { context, tx, tenantId } = operation;

  if (!PAPEIS_GESTAO_KANBAN.includes(context.role)) {
    throw new AppError({
      code: ERROR_CODES.FORBIDDEN,
      statusCode: HTTP_STATUS.FORBIDDEN,
      message: 'A lista da empresa é restrita à gestão de quadros.',
    });
  }

  return (await queries.listActiveUsers(tx, { tenantId })).map(present);
}
