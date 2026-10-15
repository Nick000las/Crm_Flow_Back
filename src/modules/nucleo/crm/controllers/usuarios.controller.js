import { sendSuccess } from '#shared/http/response.js';
import { listarResponsaveisPossiveis } from '../services/usuarios.service.js';

/**
 * CONTROLLER: HTTP fino. NUNCA importa nada de `adapters/`.
 * Liberado pra todos os papéis: o OPERADOR também atribui responsável.
 *
 * @param {import('fastify').FastifyInstance} app
 */
export function registrarRotasUsuarios(app) {
  app.get('/crm/usuarios', async (req, reply) => {
    const { tenantId } = req.tenantContext;
    return sendSuccess(reply, await listarResponsaveisPossiveis(tenantId));
  });
}
