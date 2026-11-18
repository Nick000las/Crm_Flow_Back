/**
 * @file Regras puras: referências são sempre resolvidas no snapshot autorizado do quadro.
 */
/** Regras puras: referências são sempre resolvidas no snapshot autorizado do quadro. */
export function dependencyError(details, cardId, cards) {
  const ids = Array.isArray(details.dependencias) ? details.dependencias : [];
  const byId = new Map(cards.map((card) => [card.id, card]));

  for (const id of ids) {
    if (id === cardId) {
      return 'Um card não pode depender dele mesmo.';
    }

    if (!byId.has(id)) {
      return 'A dependência deve pertencer a este quadro e empresa.';
    }

    const visited = new Set();
    const pending = [id];

    while (pending.length) {
      const current = pending.pop();

      if (current === cardId) {
        return 'Esta dependência cria um ciclo entre cards.';
      }

      if (visited.has(current)) {
        continue;
      }

      visited.add(current);

      const next = byId.get(current)?.dados_extras?.dependencias;

      if (Array.isArray(next)) {
        pending.push(...next);
      }
    }
  }

  return null;
}

export function transitionError(card, column, cards) {
  const details = card.dados_extras ?? {};

  if (details.bloqueio?.trim()) {
    return 'Resolva o bloqueio antes de mover o card.';
  }

  if (
    (details.dependencias ?? []).some(
      (id) => !cards.find((item) => item.id === id)?.dados_extras?.prazoConcluido,
    )
  ) {
    return 'Conclua as dependências antes de mover este card.';
  }

  const rules = column.regras_fluxo ?? {};

  if (rules.exigirResponsavel && !card.responsavel_id) {
    return 'Esta etapa exige um responsável.';
  }

  if (rules.exigirPrazo && !details.prazo) {
    return 'Esta etapa exige um prazo.';
  }

  if (
    rules.exigirChecklist &&
    (!details.checklist?.length || details.checklist.some((item) => !item.concluido))
  ) {
    return 'Conclua todos os itens do checklist antes de entrar nesta etapa.';
  }

  return null;
}

export function applyAutomation(card, rule, today) {
  const details = { ...card.dados_extras };

  if (rule.concluir) {
    details.prazoConcluido = true;
  }

  if (rule.prazoDias !== null && rule.prazoDias !== undefined) {
    const date = new Date(`${today}T00:00:00.000Z`);

    date.setUTCDate(date.getUTCDate() + rule.prazoDias);
    details.prazo = date.toISOString().split('T')[0];

    if (!rule.concluir) {
      details.prazoConcluido = false;
    }
  }

  return { details, assignee: rule.responsavelId || card.responsavel_id };
}
