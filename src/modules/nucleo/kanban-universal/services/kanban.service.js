import { executar, executarComEvento, verificarModulo } from '../adapters/kanban.repository.js';
import { AppError } from '#core/errors/app-error.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
export { verificarModulo };
export function operarKanban(context, action, id, data, publish) {
  if (
    ((action.startsWith('board.') && !['board.get', 'board.members'].includes(action)) ||
      action.startsWith('column.')) &&
    !['DONO', 'MASTER'].includes(context.role)
  ) {
    throw new AppError({
      code: 'FORBIDDEN',
      statusCode: HTTP_STATUS.FORBIDDEN,
      message: 'Somente donos e administradores podem gerenciar quadros e colunas.',
    });
  }
  const reads = [
    'board.get',
    'board.members',
    'card.get',
    'card.list',
    'comment.list',
    'members',
    'archive.list',
    'activity.list',
    'email.get',
  ];
  if (!publish || reads.includes(action)) {
    return executar(context.tenantId, action, id, data, context);
  }
  return executarComEvento(context.tenantId, action, id, data, context).then(
    async ({ value, event }) => {
      await publish(event);
      return value;
    },
  );
}
