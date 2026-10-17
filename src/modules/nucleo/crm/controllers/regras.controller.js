import { requireRole } from '#core/auth/rbac.js';
import { exigirFeature } from '#core/tenant/feature-flags.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { sendSuccess } from '#shared/http/response.js';
import { CRM_FEATURES, PAPEIS_GESTAO } from '../constants.js';
import { criarRegraBodySchema, editarRegraBodySchema, regraIdParamSchema } from '../schemas/regras.schema.js';
import { criarRegra, editarRegra, listarRegras, removerRegra } from '../services/regras.service.js';

/**
 * CONTROLLER: Configurações → regras de campo (M8). HTTP fino. Atrás da
 * flag `crm.regras`. Leitura pra qualquer papel (o formulário de lead usa
 * as regras pra mostrar/esconder e marcar obrigatório); escrita só
 * DONO/MASTER, papel conferido antes da flag.
 *
 * @param {import('fastify').FastifyInstance} app
 */
export function registrarRotasRegras(app) {
  const comFlag = exigirFeature(CRM_FEATURES.REGRAS);
  const apenasGestao = { preHandler: [requireRole(PAPEIS_GESTAO), comFlag] };

  app.get('/crm/configuracoes/regras', { preHandler: [comFlag] }, async (req, reply) => {
    const { tenantId } = req.tenantContext;
    return sendSuccess(reply, await listarRegras(tenantId));
  });

  app.post('/crm/configuracoes/regras', apenasGestao, async (req, reply) => {
    const { tenantId } = req.tenantContext;
    const body = criarRegraBodySchema.parse(req.body);
    return sendSuccess(reply, await criarRegra(tenantId, body), HTTP_STATUS.CREATED);
  });

  app.put('/crm/configuracoes/regras/:id', apenasGestao, async (req, reply) => {
    const { tenantId } = req.tenantContext;
    const { id } = regraIdParamSchema.parse(req.params);
    const body = editarRegraBodySchema.parse(req.body);
    return sendSuccess(reply, await editarRegra(tenantId, id, body));
  });

  app.delete('/crm/configuracoes/regras/:id', apenasGestao, async (req, reply) => {
    const { tenantId } = req.tenantContext;
    const { id } = regraIdParamSchema.parse(req.params);
    return sendSuccess(reply, await removerRegra(tenantId, id));
  });
}
