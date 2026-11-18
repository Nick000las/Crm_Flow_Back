/**
 * @file Autoriza participação e valida a seleção da equipe antes de persistir.
 * @layer service
 */
import { AppError } from '#core/errors/app-error.js';
import { HTTP_STATUS } from '#shared/constants/index.js';

import {
  buscarUsuariosAtivos,
  gravarParticipantes,
  listarParticipantes,
} from '../adapters/board-members.repository.js';

export { listarParticipantes };

export function validarParticipacao(participants, context, writing = false) {
  if (['DONO', 'MASTER'].includes(context.role)) {
    return;
  }

  if (!participants.some((user) => user.id === context.userId && user.ativo)) {
    // Evita revelar a existência de quadros aos quais o operador não tem acesso.
    throw new AppError({
      code: 'RESOURCE_NOT_FOUND',
      statusCode: HTTP_STATUS.NOT_FOUND,
      message: 'Quadro não encontrado.',
    });
  }

  if (writing && participants.find((user) => user.id === context.userId)?.permissao === 'leitor') {
    throw new AppError({
      code: 'FORBIDDEN',
      statusCode: HTTP_STATUS.FORBIDDEN,
      message: 'Seu acesso a este quadro permite apenas leitura.',
    });
  }
}

export async function exigirParticipacao(tx, tenantId, boardId, context, writing = false) {
  if (['DONO', 'MASTER'].includes(context.role)) {
    return;
  }

  validarParticipacao(await listarParticipantes(tx, tenantId, boardId), context, writing);
}

export async function salvarParticipantes(tx, tenantId, boardId, ids, permissions) {
  const users = await buscarUsuariosAtivos(tx, tenantId, ids);

  if (users.length !== ids.length) {
    throw new AppError({
      code: 'RESOURCE_CONFLICT',
      statusCode: HTTP_STATUS.CONFLICT,
      message: 'Selecione apenas usuários ativos desta empresa.',
    });
  }

  if (permissions) {
    if (
      new Set(permissions.map((item) => item.id)).size !== permissions.length ||
      permissions.some((item) => !ids.includes(item.id))
    ) {
      throw new AppError({
        code: 'RESOURCE_CONFLICT',
        statusCode: HTTP_STATUS.CONFLICT,
        message: 'Permissões devem corresponder aos participantes selecionados.',
      });
    }
  }

  await gravarParticipantes(tx, tenantId, boardId, ids, permissions);

  return listarParticipantes(tx, tenantId, boardId);
}
