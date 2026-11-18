/**
 * @file Valida detalhes, equipe, automações e recorrência antes das operações de persistência
 * nativas.
 * @layer service
 */
import { isDeepStrictEqual } from 'node:util';

import * as queries from '../adapters/kanban.repository.js';
import { listarParticipantes, salvarParticipantes } from './board-members.service.js';
import { dependencyError } from './flow-rules.js';
import { fail } from './native-kanban-state.service.js';
import { nextOccurrence } from './recurrence.js';

export function createNativeKanbanRules({
  tenantId,
  data,
  context,
  tx,
  resourceBoardId,
  board,
  column,
  card,
  columns,
  allCards,
}) {
  const requireBoard = () => board || fail('Quadro não encontrado.');
  const requireColumn = () => column || fail('Coluna não encontrada.');
  const requireCard = () => card || fail('Card não encontrado.');

  async function saveTeamWithActor(boardId, ids, permissions) {
    const selected = [...new Set([...ids, context.userId])];
    const access = [
      ...(permissions ?? []).filter((item) => item.id !== context.userId),
      { id: context.userId, permissao: 'editor' },
    ];

    return salvarParticipantes(tx, tenantId, boardId, selected, access);
  }

  const validColumn = (columnId, boardId) =>
    columns.find((c) => c.id === columnId && c.board_id === boardId) ||
    fail('A coluna não pertence ao quadro.', true);

  async function assignable() {
    if (!data.responsavelId) {
      return;
    }

    const participants = await listarParticipantes(tx, tenantId, resourceBoardId);
    const users = participants.filter((user) => user.id === data.responsavelId && user.ativo);

    if (!users.length) {
      fail('O responsável deve ser um participante ativo do quadro.', true);
    }
  }

  async function validateDetails(details, boardId, previous = {}) {
    const invalidDependency = dependencyError(details, card?.id, allCards);

    if (invalidDependency) {
      fail(invalidDependency, true);
    }

    if (
      details.proximaAcao?.lembrar &&
      !details.proximaAcao.concluida &&
      !details.prazoConcluido &&
      !(data.responsavelId === undefined ? card?.responsavel_id : data.responsavelId)
    ) {
      fail('Defina um responsável para receber o lembrete da próxima ação.', true);
    }

    if (details.bloqueioResponsavelId) {
      const participants = await listarParticipantes(tx, tenantId, boardId);

      if (
        !participants.some((member) => member.id === details.bloqueioResponsavelId && member.ativo)
      ) {
        if (details.bloqueioResponsavelId !== previous.bloqueioResponsavelId) {
          fail('Quem resolve o bloqueio deve participar do quadro.', true);
        }

        details.bloqueioResponsavelId = null;
      }
    }

    if (details.automacoes?.length) {
      const participants = await listarParticipantes(tx, tenantId, boardId);
      const validRules = [];

      for (const rule of details.automacoes) {
        const old = previous.automacoes?.find((item) => item.colunaId === rule.colunaId);

        if (!columns.some((item) => item.id === rule.colunaId && item.board_id === boardId)) {
          if (isDeepStrictEqual(rule, old)) {
            continue;
          }

          fail('A etapa da automação não pertence ao quadro.', true);
        }

        if (
          rule.responsavelId &&
          !participants.some((item) => item.id === rule.responsavelId && item.ativo)
        ) {
          if (old?.responsavelId !== rule.responsavelId) {
            fail('O responsável da automação deve ser um participante ativo do quadro.', true);
          }

          validRules.push({ ...rule, responsavelId: null });
        } else {
          validRules.push(rule);
        }
      }

      details.automacoes = validRules;
    }

    if (
      details.leadId !== null &&
      details.leadId !== undefined &&
      !isDeepStrictEqual(details.leadId, previous.leadId)
    ) {
      if (
        typeof details.leadId !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(details.leadId)
      ) {
        fail('Informe um ID válido para vincular um novo lead.', true);
      }

      const leads = await queries.findAvailableLead(tx, { tenantId, leadId: details.leadId });

      if (!leads.length) {
        fail('Lead indisponível nesta empresa.', true);
      }
    }
  }

  async function validateColumnRules(rules, boardId) {
    if (rules?.automacao?.responsavelId) {
      const participants = await listarParticipantes(tx, tenantId, boardId);

      if (
        !participants.some((member) => member.id === rules.automacao.responsavelId && member.ativo)
      ) {
        fail('O responsável da automação deve participar do quadro.', true);
      }
    }
  }

  async function repeatCard(details, source, title, assignee) {
    if (
      !details.prazoConcluido ||
      source.dados_extras?.prazoConcluido ||
      !details.recorrencia ||
      details.recorrencia === 'nenhuma' ||
      !details.prazo ||
      details.modelo
    ) {
      return;
    }

    const next = {
      ...details,
      prazo: nextOccurrence(details.prazo, details.recorrencia),
      prazoConcluido: false,
      seguidores: [],
      proximaAcao: null,
      bloqueio: '',
      bloqueioResponsavelId: null,
      dependencias: [],
      checklist: (details.checklist ?? []).map((item) => ({ ...item, concluido: false })),
    };
    const [{ total: order }] = await queries.countActiveColumnCards(tx, {
      tenantId,
      columnId: source.coluna_id,
    });

    await queries.insertRecurringCard(tx, {
      tenantId,
      boardId: source.board_id,
      columnId: source.coluna_id,
      title,
      assignee,
      details: next,
      order,
    });
  }

  async function reorder(items, columnId) {
    for (const [order, item] of items.entries()) {
      await queries.updateCardPosition(tx, { order, columnId, tenantId, cardId: item.id });
    }
  }

  return {
    requireBoard,
    requireColumn,
    requireCard,
    validColumn,
    saveTeamWithActor,
    assignable,
    validateDetails,
    validateColumnRules,
    repeatCard,
    reorder,
  };
}
