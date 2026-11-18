/**
 * @file Erros de aplicação e apresentação dos registros do Kanban.
 * @layer service
 */
import { AppError } from '#core/errors/app-error.js';
import { HTTP_STATUS } from '#shared/constants/index.js';

export const MAX_LABELS = 12;
export const HOURS_MS = 3600000;
export const METRICS_DAYS = 30;
export function fail(message, conflict = false) {
  throw new AppError({
    code: conflict ? 'RESOURCE_CONFLICT' : 'RESOURCE_NOT_FOUND',
    statusCode: conflict ? HTTP_STATUS.CONFLICT : HTTP_STATUS.NOT_FOUND,
    message,
  });
}

// O vínculo do card (M6) só sai por `comVinculo`, depois de passar pelo provedor.
const COLUNAS_INTERNAS = new Set(['tenant_id', 'entidade_tipo', 'entidade_id']);

export const present = (row) =>
  row &&
  Object.fromEntries(
    Object.entries(row)
      .filter(([key]) => !COLUNAS_INTERNAS.has(key))
      .map(([key, value]) => [
        key === 'order' ? 'ordem' : key.replace(/_([a-z])/g, (_, c) => c.toUpperCase()),
        value,
      ]),
  );

/** Card com a referência crua; `apresentarVinculos` a troca pelo vínculo legível. */
export const comVinculo = (card) => ({
  ...present(card),
  vinculo: card.entidade_id ? { tipo: card.entidade_tipo, id: card.entidade_id } : null,
});
