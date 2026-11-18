/**
 * @file Aplica criação, edição, ordenação e exclusão de etapas dos quadros nativos.
 * @layer service
 */
import * as queries from '../adapters/kanban.repository.js';
import { fail, present } from './native-kanban-state.service.js';

export async function columnCreateOperation(operation) {
  const { requireBoard, validateColumnRules, data, id, columns, tx, tenantId } = operation;

  requireBoard();
  await validateColumnRules(data.regrasFluxo, id);

  const order = columns.filter((c) => c.board_id === id).length;

  return present(
    (
      await queries.insertColumn(tx, {
        tenantId,
        boardId: id,
        name: data.nome,
        order,
        wipLimit: data.wipLimit ?? null,
        rules: data.regrasFluxo ?? {},
      })
    )[0],
  );
}

export async function columnUpdateOperation(operation) {
  const { requireColumn, validateColumnRules, data, column, tx, tenantId, id } = operation;

  requireColumn();
  await validateColumnRules(data.regrasFluxo, column.board_id);

  return present(
    (
      await queries.updateColumn(tx, {
        name: data.nome,
        wipLimit: data.wipLimit === undefined ? column.wip_limit : data.wipLimit,
        rules: data.regrasFluxo ?? column.regras_fluxo ?? {},
        tenantId,
        columnId: id,
      })
    )[0],
  );
}

export async function columnReorderOperation(operation) {
  const { requireBoard, columns, id, data, tx, tenantId } = operation;

  requireBoard();

  const ids = columns.filter((c) => c.board_id === id).map((c) => c.id);

  if (
    data.ids.length !== ids.length ||
    new Set(data.ids).size !== ids.length ||
    data.ids.some((i) => !ids.includes(i))
  ) {
    fail('Envie todas as colunas do quadro uma única vez.', true);
  }

  for (const [order, columnId] of data.ids.entries()) {
    await queries.updateColumnOrder(tx, { order, tenantId, columnId });
  }

  return null;
}

export async function columnDeleteOperation(operation) {
  const { requireColumn, allCards, id, tx, tenantId } = operation;

  requireColumn();

  if (allCards.some((c) => c.coluna_id === id)) {
    fail('Mova os cards, inclusive arquivados, antes de excluir a coluna.', true);
  }

  await queries.deleteColumn(tx, { tenantId, columnId: id });

  return null;
}
