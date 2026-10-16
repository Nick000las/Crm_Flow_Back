import { requireRole } from '#core/auth/rbac.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { sendSuccess } from '#shared/http/response.js';
import { PAPEIS_GESTAO } from '../constants.js';
import {
  definicaoIdParamSchema,
  criarDefinicaoBodySchema,
  editarDefinicaoBodySchema,
} from '../schemas/field-definitions.schema.js';
import {
  listarDefinicoesPorTenant as listarDefinicoesPorTenantService,
  criarNovaDefinicao as criarDefinicaoService,
  editarDefinicao as editarDefinicaoService,
  removerDefinicao as removerDefinicaoService,
} from '../services/field-definitions.service.js';

/**
 * CONTROLLER: HTTP fino. NUNCA importa nada de `adapters/`.
 * @param {import('fastify').FastifyInstance} app
 */
export function registrarRotasDefinicoes(app) {
  const apenasGestao = { preHandler: requireRole(PAPEIS_GESTAO) };

  app.get('/crm/field-definitions', async (req, reply) => {
    const { tenantId } = req.tenantContext;
    return sendSuccess(reply, await listarDefinicoesPorTenantService(tenantId));
  });
  app.post('/crm/field-definitions', apenasGestao, async (req, reply) => {
    const { tenantId } = req.tenantContext;
    const body = criarDefinicaoBodySchema.parse(req.body);
    const data = await criarDefinicaoService(tenantId, body);
    return sendSuccess(reply, data, HTTP_STATUS.CREATED);
  });
  app.put('/crm/field-definitions/:id', apenasGestao, async (req, reply) => {
    const { tenantId } = req.tenantContext;
    const { id: definicaoId } = definicaoIdParamSchema.parse(req.params);
    const atualizacoes = editarDefinicaoBodySchema.parse(req.body);
    return sendSuccess(reply, await editarDefinicaoService(tenantId, definicaoId, atualizacoes));
  });
  app.delete('/crm/field-definitions/:id', apenasGestao, async (req, reply) => {
    const { tenantId } = req.tenantContext;
    const { id: definicaoId } = definicaoIdParamSchema.parse(req.params);
    return sendSuccess(reply, await removerDefinicaoService(tenantId, definicaoId));
  });
}
