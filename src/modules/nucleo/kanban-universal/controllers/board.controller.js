import { z } from 'zod';
import { sendSuccess } from '#shared/http/response.js';
import { listarCardsDoBoard, moverCardDeColuna } from '../services/board.service.js';

const moverCardBodySchema = z.object({ novaColunaId: z.string().uuid() });
const boardParamsSchema = z.object({ boardId: z.string().uuid() });
const cardParamsSchema = z.object({ cardId: z.string().uuid() });

/**
 * CONTROLLER: HTTP fino. NUNCA importa nada de `adapters/`.
 * @param {import('fastify').FastifyInstance} app
 */
export function registrarRotasKanban(app) {
  app.get('/kanban/boards/:boardId/cards', async (req, reply) => {
    const { tenantId } = req.tenantContext;
    const { boardId } = boardParamsSchema.parse(req.params);
    return sendSuccess(reply, await listarCardsDoBoard(tenantId, boardId));
  });

  app.patch('/kanban/cards/:cardId/mover', async (req, reply) => {
    const { tenantId } = req.tenantContext;
    const { cardId } = cardParamsSchema.parse(req.params);
    const { novaColunaId } = moverCardBodySchema.parse(req.body);
    await moverCardDeColuna(tenantId, cardId, novaColunaId);
    return sendSuccess(reply, null);
  });
}
