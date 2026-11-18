/**
 * @file Calcula as métricas de fluxo usando snapshots e agregações históricas persistidas.
 * @layer service
 */
import * as queries from '../adapters/kanban.repository.js';
import { HOURS_MS, METRICS_DAYS } from './native-kanban-state.service.js';

export async function metricsGetOperation(operation) {
  const { requireBoard, tx, tenantId, id, cards, allCards, columns } = operation;

  requireBoard();

  const completions = await queries.listCardCompletions(tx, { tenantId, boardId: id });
  const open = cards.filter(
    (item) => !item.dados_extras?.modelo && !item.dados_extras?.prazoConcluido,
  );
  const now = Date.now();
  const cutoff = new Date(now);

  cutoff.setUTCDate(cutoff.getUTCDate() - METRICS_DAYS);

  return {
    abertos: open.length,
    bloqueados: open.filter(
      (item) =>
        item.dados_extras?.bloqueio ||
        (item.dados_extras?.dependencias ?? []).some(
          (dep) => !allCards.find((other) => other.id === dep)?.dados_extras?.prazoConcluido,
        ),
    ).length,
    concluidos: completions.length,
    concluidos30Dias: completions.filter((item) => new Date(item.completed_at) >= cutoff).length,
    tempoMedioConclusaoHoras: completions.length
      ? completions.reduce(
          (sum, item) => sum + (new Date(item.completed_at) - new Date(item.created_at)) / HOURS_MS,
          0,
        ) / completions.length
      : 0,
    etapas: columns.map((stage) => {
      const items = open.filter((item) => item.coluna_id === stage.id);

      return {
        id: stage.id,
        nome: stage.nome,
        abertos: items.length,
        wipLimit: stage.wip_limit,
        idadeMediaHoras: items.length
          ? items.reduce(
              (sum, item) => sum + (now - new Date(item.etapa_desde ?? item.created_at)) / HOURS_MS,
              0,
            ) / items.length
          : 0,
      };
    }),
  };
}

export async function reportGetOperation(operation) {
  const { requireBoard, tx, tenantId, id } = operation;

  requireBoard();

  return queries.reportStageDurations(tx, { tenantId, boardId: id });
}
