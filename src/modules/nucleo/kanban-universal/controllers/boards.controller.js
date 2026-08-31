import { sendSuccess } from '#shared/http/response.js';
import { listarBoardsDoTenant } from '../services/boards.service.js';

/**
 * CONTROLLER: HTTP fino. NUNCA importa nada de `adapters/`.
 * @param {import('fastify').FastifyInstance} app
 */
export function registrarRotasBoards(app) {
  app.get('/kanban/boards', async (request, reply) => {
    const boards = await listarBoardsDoTenant(request.tenantContext);
    return sendSuccess(reply, boards);
  });
}
