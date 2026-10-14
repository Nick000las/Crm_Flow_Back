import { HTTP_STATUS } from '#shared/constants/index.js';
import { sendSuccess } from '#shared/http/response.js';
import { listarViews, salvarView, excluirView } from '../services/filter-views.service.js';
import { salvarViewBodySchema, viewIdParamSchema } from '../schemas/filter-views.schema.js';

/**
 * CONTROLLER: HTTP fino. NUNCA importa nada de `adapters/`.
 * @param {import('fastify').FastifyInstance} app
 */
export function registrarRotasViews(app) {
  app.get('/crm/filter-views', async (req, reply) => {
    const { tenantId, userId } = req.tenantContext;
    return sendSuccess(reply, await listarViews(tenantId, userId));
  });

  app.post('/crm/filter-views', async (req, reply) => {
    const { tenantId, userId } = req.tenantContext;
    const body = salvarViewBodySchema.parse(req.body);
    return sendSuccess(reply, await salvarView(tenantId, userId, body), HTTP_STATUS.CREATED);
  });

  app.delete('/crm/filter-views/:id', async (req, reply) => {
    const { tenantId, userId } = req.tenantContext;
    const { id: viewId } = viewIdParamSchema.parse(req.params);
    return sendSuccess(reply, await excluirView(tenantId, userId, viewId));
  });
}
