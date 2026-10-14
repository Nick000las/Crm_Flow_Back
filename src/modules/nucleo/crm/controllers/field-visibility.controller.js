import { requireRole } from '#core/auth/rbac.js';
import { sendSuccess } from '#shared/http/response.js';
import { PAPEIS_GESTAO } from '../constants.js';
import {
  listarVisibilidadeDoTenant as listarVisibilidadeService,
  atualizarVisibilidadeDoTenant as atualizarVisibilidadeService,
} from '../services/field-visibility.service.js';
import { definirVisibilidadeBodySchema } from '../schemas/field-visibility.schema.js';

/**
 * CONTROLLER: HTTP fino. NUNCA importa nada de `adapters/`.
 * @param {import('fastify').FastifyInstance} app
 */
export function registrarRotasVisibilidade(app) {
  const apenasGestao = { preHandler: requireRole(PAPEIS_GESTAO) };
  app.get('/crm/field-visibility', async (req, reply) => {
    const { tenantId } = req.tenantContext;
    return sendSuccess(reply, await listarVisibilidadeService(tenantId));
  });

  app.put('/crm/field-visibility', apenasGestao, async (req, reply) => {
    const { tenantId } = req.tenantContext;
    const itens = definirVisibilidadeBodySchema.parse(req.body);
    return sendSuccess(reply, await atualizarVisibilidadeService(tenantId, itens));
  });
}
