import { requireRole } from '#core/auth/rbac.js';
import { exigirFeature } from '#core/tenant/feature-flags.js';
import { sendSuccess } from '#shared/http/response.js';
import { CRM_FEATURES, PAPEIS_GESTAO } from '../constants.js';
import { salvarLgpdBodySchema } from '../schemas/lgpd.schema.js';
import { leadIdParamSchema } from '../schemas/leads.schema.js';
import { anonimizarLeadDoTitular, obterConfigLgpd, salvarConfigLgpd } from '../services/lgpd.service.js';

/**
 * CONTROLLER: base legal LGPD (M15). HTTP fino. Atrás da flag `crm.lgpd`.
 * Leitura pra qualquer papel (o formulário precisa das opções e de saber
 * se é obrigatória); escrita e anonimização só DONO/MASTER, papel antes da flag.
 *
 * - `GET /crm/configuracoes/lgpd`: `{ basePadrao, obrigatoria, basesLegais:
 *   [{ key, label }], origensRegistro: [{ key, label }] }`.
 * - `PUT`: `{ basePadrao: <key> | null, obrigatoria }`; liga os campos LGPD
 *   no detalhe, na tabela e no filtro (a Base legal também no formulário).
 * - `POST /crm/leads/:id/anonimizar`: pedido do titular, irreversível →
 *   `{ leadId, leads, atividades, eventos }` (contagens). Já anonimizado → 409.
 *
 * @param {import('fastify').FastifyInstance} app
 */
export function registrarRotasLgpd(app) {
  const comFlag = exigirFeature(CRM_FEATURES.LGPD);
  const apenasGestao = { preHandler: [requireRole(PAPEIS_GESTAO), comFlag] };

  app.get('/crm/configuracoes/lgpd', { preHandler: [comFlag] }, async (req, reply) => {
    const { tenantId } = req.tenantContext;
    return sendSuccess(reply, await obterConfigLgpd(tenantId));
  });

  app.put('/crm/configuracoes/lgpd', apenasGestao, async (req, reply) => {
    const { tenantId } = req.tenantContext;
    const body = salvarLgpdBodySchema.parse(req.body);
    return sendSuccess(reply, await salvarConfigLgpd(tenantId, body));
  });

  app.post('/crm/leads/:id/anonimizar', apenasGestao, async (req, reply) => {
    const { tenantId, userId } = req.tenantContext;
    const { id: leadId } = leadIdParamSchema.parse(req.params);
    return sendSuccess(reply, await anonimizarLeadDoTitular(tenantId, leadId, userId ?? null));
  });
}
