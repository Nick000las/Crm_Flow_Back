/**
 * @file Valida movimentação, arquivamento e exclusão de cards, executando automações de etapa.
 * @layer service
 */
import * as queries from '../adapters/kanban.repository.js';
import { listarParticipantes } from './board-members.service.js';
import { applyAutomation, transitionError } from './flow-rules.js';
import { fail, present } from './native-kanban-state.service.js';

export async function cardArchiveOperation(operation) {
  const { requireCard, data, card, action, cards, id, tx, tenantId, reorder } = operation;

  requireCard();

  if (
    data.expectedUpdatedAt &&
    new Date(data.expectedUpdatedAt).getTime() !== new Date(card.updated_at).getTime()
  ) {
    fail('Este card mudou. Atualize antes de continuar.', true);
  }

  const restoring = action === 'card.restore';
  const archivedAt = restoring ? null : new Date();
  const order = cards.filter((item) => item.coluna_id === card.coluna_id && item.id !== id).length;
  const result = (
    await queries.updateCardArchive(tx, { archivedAt, order, tenantId, cardId: id })
  )[0];

  await reorder(
    cards.filter((item) => item.coluna_id === card.coluna_id && item.id !== id),
    card.coluna_id,
  );

  return present(result);
}

export async function cardMoveOperation(operation) {
  const {
    requireCard,
    validColumn,
    data,
    card,
    allCards,
    validateDetails,
    cards,
    id,
    reorder,
    tenantId,
    tx,
    context,
    repeatCard,
  } = operation;

  requireCard();
  validColumn(data.novaColunaId, card.board_id);

  const destination = validColumn(data.novaColunaId, card.board_id);

  if (card.coluna_id !== data.novaColunaId) {
    const impediment = transitionError(card, destination, allCards);

    if (impediment) {
      fail(impediment, true);
    }
  }

  const moveDetails = { ...card.dados_extras };

  await validateDetails(moveDetails, card.board_id, card.dados_extras ?? {});

  const target = cards.filter((c) => c.coluna_id === data.novaColunaId && c.id !== id);

  target.splice(Math.min(data.novaOrdem, target.length), 0, card);

  if (card.coluna_id !== data.novaColunaId) {
    await reorder(
      cards.filter((c) => c.coluna_id === card.coluna_id && c.id !== id),
      card.coluna_id,
    );
  }

  await reorder(target, data.novaColunaId);

  if (card.coluna_id !== data.novaColunaId) {
    const rule = {
      ...destination.regras_fluxo?.automacao,
      ...moveDetails.automacoes?.find((item) => item.colunaId === data.novaColunaId),
    };

    if (
      rule.concluir ||
      rule.responsavelId ||
      (rule.prazoDias !== undefined && rule.prazoDias !== null) ||
      rule.tarefa?.trim()
    ) {
      // Metadado de plataforma: app_tenant não pode ler public.tenants.
      const company = await queries.findCompanyTimezone(tenantId);
      const hoje = new Intl.DateTimeFormat('en-CA', {
        timeZone: company?.fusoHorario ?? 'America/Sao_Paulo',
      }).format(new Date());
      const applied = applyAutomation({ ...card, dados_extras: moveDetails }, rule, hoje);

      if (applied.assignee) {
        const participants = await listarParticipantes(tx, tenantId, card.board_id);

        if (!participants.some((member) => member.id === applied.assignee && member.ativo)) {
          applied.assignee = participants.some(
            (member) => member.id === card.responsavel_id && member.ativo,
          )
            ? card.responsavel_id
            : null;
        }
      }

      if (applied.details.prazoConcluido && !card.dados_extras?.prazoConcluido) {
        await queries.insertCompletionActivity(tx, {
          tenantId,
          boardId: card.board_id,
          cardId: id,
          actorId: context.userId,
        });
      }

      await repeatCard(applied.details, card, card.titulo, applied.assignee);

      await queries.updateAutomatedCard(tx, {
        details: applied.details,
        assignee: applied.assignee,
        tenantId,
        cardId: id,
      });

      if (rule.tarefa?.trim()) {
        const taskDetails = {
          prazo: applied.details.prazo ?? null,
          descricao: 'Criado automaticamente ao mover um card de etapa.',
        };

        await queries.insertAutomatedTask(tx, {
          tenantId,
          boardId: card.board_id,
          columnId: data.novaColunaId,
          title: rule.tarefa,
          assignee: applied.assignee,
          details: taskDetails,
          order: target.length,
        });
      }
    }
  }

  if (card.coluna_id === data.novaColunaId) {
    await queries.insertMoveActivity(tx, {
      tenantId,
      boardId: card.board_id,
      cardId: id,
      actorId: context.userId,
      details: { colunaId: card.coluna_id, novaOrdem: data.novaOrdem },
    });
  }

  const result = (await queries.findCard(tx, { tenantId, cardId: id }))[0];

  return {
    ...present(result),
    conflito: Boolean(
      data.expectedUpdatedAt &&
      new Date(data.expectedUpdatedAt).getTime() !== new Date(card.updated_at).getTime(),
    ),
  };
}

export async function cardDeleteOperation(operation) {
  const { requireCard, allCards, id, tx, tenantId, reorder, cards, card } = operation;

  requireCard();

  if (allCards.some((item) => (item.dados_extras?.dependencias ?? []).includes(id))) {
    fail('Remova as dependências deste card antes de excluí-lo.', true);
  }

  await queries.deleteCard(tx, { tenantId, cardId: id });

  await reorder(
    cards.filter((c) => c.coluna_id === card.coluna_id && c.id !== id),
    card.coluna_id,
  );

  return null;
}
