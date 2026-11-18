/**
 * @file Aplica criação, cópia, edição, vínculo e acompanhamento de cards nativos.
 * @layer service
 */
import * as queries from '../adapters/kanban.repository.js';
import { transitionError } from './flow-rules.js';
import { comVinculo, fail, present } from './native-kanban-state.service.js';

export async function cardLinkOperation(operation) {
  const { requireCard, data, card, tx, tenantId, id, context } = operation;

  requireCard();

  const entidadeTipo = data.entidadeTipo ?? null;
  const entidadeId = data.entidadeId ?? null;

  if ((card.entidade_id ?? null) === entidadeId) {
    return comVinculo(card);
  }

  const updated = (
    await queries.updateCardLink(tx, {
      entityType: entidadeTipo,
      entityId: entidadeId,
      tenantId,
      cardId: id,
    })
  )[0];

  // Sem o id do registro: o histórico do card não guarda referência à pessoa.
  await queries.insertLinkActivity(tx, {
    tenantId,
    boardId: card.board_id,
    cardId: id,
    actorId: context.userId,
    action: entidadeId ? 'card.link' : 'card.unlink',
    details: { entidadeTipo: entidadeTipo ?? card.entidade_tipo },
  });

  return comVinculo(updated);
}

export async function cardCreateOperation(operation) {
  const { requireBoard, validColumn, data, id, assignable, validateDetails, cards, tx, tenantId } =
    operation;

  requireBoard();
  validColumn(data.colunaId, id);
  await assignable();

  if (data.dadosExtras) {
    delete data.dadosExtras.seguidores;
  }

  await validateDetails(data.dadosExtras ?? {}, id);

  const order = cards.filter((c) => c.coluna_id === data.colunaId).length;

  return present(
    (
      await queries.insertCard(tx, {
        tenantId,
        boardId: id,
        columnId: data.colunaId,
        title: data.titulo,
        assignee: data.responsavelId ?? null,
        details: data.dadosExtras ?? {},
        order,
      })
    )[0],
  );
}

export async function cardFollowOperation(operation) {
  const { requireCard, card, data, context, tx, tenantId, id } = operation;

  requireCard();

  const seguidores = new Set(card.dados_extras?.seguidores ?? []);

  if (data.seguindo) {
    seguidores.add(context.userId);
  } else {
    seguidores.delete(context.userId);
  }

  const details = { ...card.dados_extras, seguidores: [...seguidores] };

  return present((await queries.updateCardDetails(tx, { details, tenantId, cardId: id }))[0]);
}

export async function cardDuplicateOperation(operation) {
  const { requireCard, card, data, validateDetails, cards, tx, tenantId } = operation;

  requireCard();

  const details = {
    ...card.dados_extras,
    modelo: data.modelo,
    seguidores: [],
    prazoConcluido: false,
    checklist: (card.dados_extras?.checklist ?? []).map((item) => ({
      ...item,
      concluido: false,
    })),
  };

  await validateDetails(details, card.board_id, card.dados_extras ?? {});

  const order = cards.filter((item) => item.coluna_id === card.coluna_id).length;

  return present(
    (
      await queries.insertCardCopy(tx, {
        tenantId,
        boardId: card.board_id,
        columnId: card.coluna_id,
        title: card.titulo,
        assignee: card.responsavel_id,
        details,
        order,
      })
    )[0],
  );
}

export async function cardUpdateOperation(operation) {
  const {
    requireCard,
    data,
    card,
    assignable,
    validateDetails,
    allCards,
    tx,
    tenantId,
    id,
    context,
    repeatCard,
  } = operation;

  requireCard();

  if (
    data.expectedUpdatedAt &&
    new Date(data.expectedUpdatedAt).getTime() !== new Date(card.updated_at).getTime()
  ) {
    fail('Este card foi alterado por outra pessoa. Carregue a versão atual antes de salvar.', true);
  }

  await assignable();

  const details = {
    ...card.dados_extras,
    ...data.dadosExtras,
    ...(card.dados_extras?.seguidores && { seguidores: card.dados_extras.seguidores }),
  };

  if (!card.dados_extras?.seguidores) {
    delete details.seguidores;
  }

  await validateDetails(details, card.board_id, card.dados_extras ?? {});

  if (details.prazoConcluido === true && card.dados_extras?.prazoConcluido !== true) {
    const impediment = transitionError({ ...card, dados_extras: details }, {}, allCards);

    if (impediment) {
      fail(impediment, true);
    }

    await queries.insertCompletionActivity(tx, {
      tenantId,
      boardId: card.board_id,
      cardId: id,
      actorId: context.userId,
    });
  }

  await repeatCard(
    details,
    card,
    data.titulo ?? card.titulo,
    data.responsavelId === undefined ? card.responsavel_id : data.responsavelId,
  );

  return present(
    (
      await queries.updateCard(tx, {
        title: data.titulo ?? card.titulo,
        assignee: data.responsavelId === undefined ? card.responsavel_id : data.responsavelId,
        details,
        tenantId,
        cardId: id,
      })
    )[0],
  );
}
