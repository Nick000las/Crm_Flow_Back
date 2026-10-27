import { requireRole } from '#core/auth/rbac.js';
import { exigirFeature } from '#core/tenant/feature-flags.js';
import { sendSuccess } from '#shared/http/response.js';
import { CRM_FEATURES, PAPEIS_GESTAO } from '../constants.js';
import { salvarPermissoesBodySchema } from '../schemas/permissoes.schema.js';
import { obterPermissoes, salvarPermissoes } from '../services/permissoes.service.js';

/**
 * CONTROLLER: Configurações → permissões por campo (M13). HTTP fino. Atrás
 * da flag `crm.permissoes`, só DONO/MASTER (papel conferido antes da flag)
 * — o OPERADOR já recebe o próprio acesso em `GET /crm/leads/fields`.
 *
 * - `GET /crm/configuracoes/permissoes`: `{ papeis, campos: [{ id, chave,
 *   label, camada, podeRestringir, acessos: { OPERADOR: 'edit' | 'view' |
 *   'hidden' } }] }`.
 * - `PUT`: `{ OPERADOR: { [campoId]: acesso } }` — o mapa inteiro do papel.
 *
 * @param {import('fastify').FastifyInstance} app
 */
export function registrarRotasPermissoes(app) {
  const apenasGestao = { preHandler: [requireRole(PAPEIS_GESTAO), exigirFeature(CRM_FEATURES.PERMISSOES)] };

  app.get('/crm/configuracoes/permissoes', apenasGestao, async (req, reply) => {
    const { tenantId } = req.tenantContext;
    return sendSuccess(reply, await obterPermissoes(tenantId));
  });

  app.put('/crm/configuracoes/permissoes', apenasGestao, async (req, reply) => {
    const { tenantId } = req.tenantContext;
    const body = salvarPermissoesBodySchema.parse(req.body);
    return sendSuccess(reply, await salvarPermissoes(tenantId, body));
  });
}
