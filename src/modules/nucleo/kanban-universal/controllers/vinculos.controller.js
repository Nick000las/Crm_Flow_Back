import { exigirFeature } from '#core/tenant/feature-flags.js';
import { sendSuccess } from '#shared/http/response.js';
import { KANBAN_FEATURES } from '../constants.js';
import { cardVinculoParamsSchema, entidadeSchema } from '../schemas/vinculo.schema.js';
import {
  desvincularCard,
  listarCardsDaEntidade,
  vincularCard,
} from '../services/vinculo.service.js';

/**
 * Vínculo de card de projeto com um registro de outro módulo (M6). A aba
 * "Projetos" chama `GET /kanban/vinculos` direto: o CRM não importa o Kanban.
 *
 * @param {import('fastify').FastifyInstance} app
 */
export function registrarRotasVinculos(app) {
  const comFlag = { preHandler: [exigirFeature(KANBAN_FEATURES.VINCULO_ENTIDADE)] };

  app.get('/kanban/vinculos', comFlag, async (req, reply) => {
    const entidade = entidadeSchema.parse(req.query);
    return sendSuccess(reply, await listarCardsDaEntidade(req.tenantContext, entidade));
  });

  app.put('/kanban/cards/:id/vinculo', comFlag, async (req, reply) => {
    const { id } = cardVinculoParamsSchema.parse(req.params);
    const entidade = entidadeSchema.parse(req.body);
    return sendSuccess(
      reply,
      await vincularCard(req.tenantContext, id, entidade, app.publicarKanban, req.log),
    );
  });

  app.delete('/kanban/cards/:id/vinculo', comFlag, async (req, reply) => {
    const { id } = cardVinculoParamsSchema.parse(req.params);
    await desvincularCard(req.tenantContext, id, app.publicarKanban);
    return sendSuccess(reply, null);
  });
}
