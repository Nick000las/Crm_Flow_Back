import { requireRole } from '#core/auth/rbac.js';
import { exigirFeature } from '#core/tenant/feature-flags.js';
import { sendSuccess } from '#shared/http/response.js';
import { CRM_FEATURES, PAPEIS_GESTAO } from '../constants.js';
import { salvarRegrasDuplicidadeBodySchema } from '../schemas/duplicidade.schema.js';
import { listarRegras, salvarRegras } from '../services/duplicidade.service.js';

/**
 * CONTROLLER: Configurações → Duplicidade (M7). HTTP fino. Atrás da flag
 * `crm.duplicidade`; leitura pra qualquer papel, escrita só DONO/MASTER
 * (papel conferido antes da flag, pra OPERADOR receber sempre 403 `FORBIDDEN`).
 *
 * Resposta: `{ regras: [{ campo, label, acao, ativo }], configurado }`.
 *
 * @param {import('fastify').FastifyInstance} app
 */
export function registrarRotasDuplicidade(app) {
  const comFlag = exigirFeature(CRM_FEATURES.DUPLICIDADE);

  app.get('/crm/configuracoes/duplicidade', { preHandler: [comFlag] }, async (req, reply) => {
    const { tenantId } = req.tenantContext;
    return sendSuccess(reply, await listarRegras(tenantId));
  });

  app.put(
    '/crm/configuracoes/duplicidade',
    { preHandler: [requireRole(PAPEIS_GESTAO), comFlag] },
    async (req, reply) => {
      const { tenantId } = req.tenantContext;
      const { regras } = salvarRegrasDuplicidadeBodySchema.parse(req.body);
      return sendSuccess(reply, await salvarRegras(tenantId, regras));
    },
  );
}
