import { requireRole } from '#core/auth/rbac.js';
import { exigirFeature } from '#core/tenant/feature-flags.js';
import { sendSuccess } from '#shared/http/response.js';
import { CRM_FEATURES, PAPEIS_GESTAO } from '../constants.js';
import { salvarInatividadeBodySchema } from '../schemas/inatividade.schema.js';
import { listarInatividade, salvarInatividade } from '../services/inatividade.service.js';

/**
 * CONTROLLER: Configurações → inatividade (M9), os dias até o lead esfriar
 * por status. HTTP fino. Atrás da flag `crm.inatividade`. Leitura pra
 * qualquer papel; escrita só DONO/MASTER, papel conferido antes da flag.
 *
 * @param {import('fastify').FastifyInstance} app
 */
export function registrarRotasInatividade(app) {
  const comFlag = exigirFeature(CRM_FEATURES.INATIVIDADE);

  app.get('/crm/configuracoes/inatividade', { preHandler: [comFlag] }, async (req, reply) => {
    const { tenantId } = req.tenantContext;
    return sendSuccess(reply, await listarInatividade(tenantId));
  });

  app.put(
    '/crm/configuracoes/inatividade',
    { preHandler: [requireRole(PAPEIS_GESTAO), comFlag] },
    async (req, reply) => {
      const { tenantId } = req.tenantContext;
      const body = salvarInatividadeBodySchema.parse(req.body);
      return sendSuccess(reply, await salvarInatividade(tenantId, body));
    },
  );
}
