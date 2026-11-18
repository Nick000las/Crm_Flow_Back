/**
 * @file Autoriza sessões e salas Socket.IO usando snapshots restritos ao tenant.
 * @layer service
 */
import { AppError } from '#core/errors/app-error.js';
import { HTTP_STATUS } from '#shared/constants/index.js';

import { buscarDadosDaSala, buscarUsuarioDaConexao } from '../adapters/realtime.repository.js';
import { validarParticipacao } from './board-members.service.js';

export { listarDestinatarios } from '../adapters/realtime.repository.js';

export async function autenticarConexao(context) {
  const user = await buscarUsuarioDaConexao(context);

  if (!user) {
    throw new AppError({
      code: 'FORBIDDEN',
      statusCode: HTTP_STATUS.FORBIDDEN,
      message: 'Acesso ao Kanban indisponível.',
    });
  }

  return { ...context, role: user.role };
}

export async function autorizarSala(context, boardId, cardId) {
  const snapshot = await buscarDadosDaSala(context, boardId, cardId);

  if (!snapshot.boards.length) {
    throw new AppError({
      code: 'RESOURCE_NOT_FOUND',
      statusCode: HTTP_STATUS.NOT_FOUND,
      message: 'Quadro não encontrado.',
    });
  }

  validarParticipacao(snapshot.participants, context);

  if (cardId && !snapshot.cards.length) {
    throw new AppError({
      code: 'RESOURCE_NOT_FOUND',
      statusCode: HTTP_STATUS.NOT_FOUND,
      message: 'Card não encontrado.',
    });
  }
}
