import { requireRole } from '#core/auth/rbac.js';
import { exigirFeature } from '#core/tenant/feature-flags.js';
import { sendSuccess } from '#shared/http/response.js';
import { CRM_FEATURES, PAPEIS_GESTAO } from '../constants.js';
import { cnpjParamSchema, salvarConfigCnpjBodySchema } from '../schemas/cnpj.schema.js';
import { consultarParaLupa, encerrarEnriquecimento, listarConfigCnpj, salvarConfigCnpj } from '../services/cnpj.service.js';

/**
 * CONTROLLER: enriquecimento por CNPJ (M11b). HTTP fino. Atrás da flag
 * `crm.cnpj`.
 *
 * - `GET /crm/cnpj/:cnpj` (lupa, qualquer papel): `{ cnpj, status, dados,
 *   sugestao: [{ campoReceita, chave, label, tipo, camada, valor }] }`. Não grava
 *   no lead. 403 com `ativo: false` na config; 503 com o provedor fora.
 * - `GET`/`PUT /crm/configuracoes/cnpj`: leitura qualquer papel, escrita
 *   DONO/MASTER (papel conferido antes da flag).
 *
 * @param {import('fastify').FastifyInstance} app
 */
export function registrarRotasCnpj(app) {
  const comFlag = exigirFeature(CRM_FEATURES.CNPJ);
  app.addHook('onClose', async () => encerrarEnriquecimento());

  app.get('/crm/cnpj/:cnpj', { preHandler: [comFlag] }, async (req, reply) => {
    const { tenantId } = req.tenantContext;
    const { cnpj } = cnpjParamSchema.parse(req.params);
    return sendSuccess(reply, await consultarParaLupa(tenantId, cnpj));
  });

  app.get('/crm/configuracoes/cnpj', { preHandler: [comFlag] }, async (req, reply) => {
    const { tenantId } = req.tenantContext;
    return sendSuccess(reply, await listarConfigCnpj(tenantId));
  });

  app.put('/crm/configuracoes/cnpj', { preHandler: [requireRole(PAPEIS_GESTAO), comFlag] }, async (req, reply) => {
    const { tenantId } = req.tenantContext;
    const body = salvarConfigCnpjBodySchema.parse(req.body);
    return sendSuccess(reply, await salvarConfigCnpj(tenantId, body));
  });
}
