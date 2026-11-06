import { executar, executarComEvento } from '../adapters/kanban.repository.js';
import { ACOES_DE_LEITURA, PAPEIS_GESTAO_KANBAN } from '../constants.js';
import { AppError } from '#core/errors/app-error.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { ERROR_CODES } from '#shared/http/error-codes.js';
export function operarKanban(context, action, id, data, publish) {
  if (
    ((action.startsWith('board.') && !['board.get', 'board.members'].includes(action)) ||
      action.startsWith('column.')) &&
    !PAPEIS_GESTAO_KANBAN.includes(context.role)
  ) {
    throw new AppError({
      code: ERROR_CODES.FORBIDDEN,
      statusCode: HTTP_STATUS.FORBIDDEN,
      message: 'Somente donos e administradores podem gerenciar quadros e colunas.',
    });
  }
  if (!publish || ACOES_DE_LEITURA.has(action)) {
    return executar(context.tenantId, action, id, data, context);
  }
  return executarComEvento(context.tenantId, action, id, data, context).then(
    async ({ value, event }) => {
      await publish(event);
      return value;
    },
  );
}
