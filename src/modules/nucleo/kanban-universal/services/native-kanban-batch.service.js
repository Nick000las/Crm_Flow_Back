/**
 * @file Valida versões e coordena ações atômicas sobre vários cards do mesmo quadro.
 * @layer service
 */
import { fail, MAX_LABELS } from './native-kanban-state.service.js';

export async function cardBatchOperation(operation) {
  const { requireBoard, data, cards, id, executar, tenantId, context, tx } = operation;

  requireBoard();

  for (const item of data.cards) {
    const source = cards.find((candidate) => candidate.id === item.id);

    if (!source || source.board_id !== id) {
      fail('Um dos cards não pertence a este quadro.', true);
    }

    if (new Date(item.expectedUpdatedAt).getTime() !== new Date(source.updated_at).getTime()) {
      fail('Um dos cards mudou. Atualize o quadro antes de aplicar o lote.', true);
    }
  }

  // Mesma transação e lock do quadro: qualquer falha desfaz o lote inteiro.
  const results = [];

  for (const item of data.cards) {
    const source = cards.find((candidate) => candidate.id === item.id);
    let operation;
    let payload;

    if (data.acao === 'mover') {
      operation = 'card.move';
      payload = { novaColunaId: data.colunaId, novaOrdem: cards.length };
    } else if (data.acao === 'arquivar') {
      operation = 'card.archive';
      payload = {};
    } else if (data.acao === 'atribuir') {
      operation = 'card.update';
      payload = { responsavelId: data.responsavelId };
    } else {
      const labels = (source.dados_extras?.etiquetas ?? []).filter(
        (label) =>
          label.nome.toLocaleLowerCase('pt-BR') !== data.etiqueta.nome.toLocaleLowerCase('pt-BR'),
      );

      if (labels.length >= MAX_LABELS) {
        fail('Um dos cards já atingiu o limite de etiquetas.', true);
      }

      operation = 'card.update';
      payload = { dadosExtras: { etiquetas: [...labels, data.etiqueta] } };
    }

    results.push(await executar(tenantId, operation, item.id, payload, context, undefined, tx));
  }

  return { total: results.length };
}
