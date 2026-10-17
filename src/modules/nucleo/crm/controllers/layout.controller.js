import { requireRole } from '#core/auth/rbac.js';
import { exigirFeature } from '#core/tenant/feature-flags.js';
import { sendSuccess } from '#shared/http/response.js';
import { CRM_FEATURES, PAPEIS_GESTAO } from '../constants.js';
import { layoutMeuBodySchema, layoutPadraoBodySchema } from '../schemas/layout.schema.js';
import { obterLayout, removerMeu, salvarMeu, salvarPadrao } from '../services/layout.service.js';

/**
 * CONTROLLER: layout do lead (M4). HTTP fino. Atrás da flag `crm.layout`
 * (desligada, o front segue com o layout fixo de hoje).
 *
 * - Leitura e o override pessoal: qualquer papel (cada um mexe só no seu).
 * - Padrão do tenant: só DONO/MASTER — o papel é conferido antes da flag,
 *   pra OPERADOR receber sempre o mesmo 403 `FORBIDDEN`.
 *
 * Toda resposta é `{ padrao, padraoConfigurado, meu, efetivo }`.
 *
 * @param {import('fastify').FastifyInstance} app
 */
export function registrarRotasLayout(app) {
  const comFlag = exigirFeature(CRM_FEATURES.LAYOUT);
  const qualquerPapel = { preHandler: [comFlag] };
  const apenasGestao = { preHandler: [requireRole(PAPEIS_GESTAO), comFlag] };

  app.get('/crm/layout', qualquerPapel, async (req, reply) => {
    const { tenantId, userId } = req.tenantContext;
    return sendSuccess(reply, await obterLayout(tenantId, userId));
  });

  app.put('/crm/layout/padrao', apenasGestao, async (req, reply) => {
    const { tenantId, userId } = req.tenantContext;
    const layout = layoutPadraoBodySchema.parse(req.body);
    return sendSuccess(reply, await salvarPadrao(tenantId, userId, layout));
  });

  app.put('/crm/layout/meu', qualquerPapel, async (req, reply) => {
    const { tenantId, userId } = req.tenantContext;
    const parcial = layoutMeuBodySchema.parse(req.body);
    return sendSuccess(reply, await salvarMeu(tenantId, userId, parcial));
  });

  app.delete('/crm/layout/meu', qualquerPapel, async (req, reply) => {
    const { tenantId, userId } = req.tenantContext;
    return sendSuccess(reply, await removerMeu(tenantId, userId));
  });
}
