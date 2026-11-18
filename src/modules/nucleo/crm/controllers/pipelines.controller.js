/**
 * @file CONTROLLER: Configurações → Pipelines (M2.5, F6). HTTP fino. Leitura liberada a
 * qualquer papel do tenant, como em Listas: a aba Oportunidades da ficha precisa dos pipelines
 * e dos status. Escrita só DONO/MASTER.
 */
import { requireRole } from '#core/auth/rbac.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { sendSuccess } from '#shared/http/response.js';

import { PAPEIS_GESTAO } from '../constants.js';
import {
  atualizarOpcaoBodySchema,
  criarOpcaoBodySchema,
  reordenarListaBodySchema,
} from '../schemas/listas.schema.js';
import {
  atualizarPipelineBodySchema,
  criarPipelineBodySchema,
  pipelineParamSchema,
  statusParamSchema,
} from '../schemas/pipelines.schema.js';
import {
  atualizarPipeline,
  atualizarStatus,
  criarPipeline,
  criarStatus,
  excluirPipeline,
  excluirStatus,
  listarPipelines,
  reordenarStatus,
} from '../services/pipelines.service.js';

/**
 * CONTROLLER: Configurações → Pipelines (M2.5, F6). HTTP fino.
 *
 * Leitura liberada a qualquer papel do tenant, como em Listas: a aba
 * Oportunidades da ficha precisa dos pipelines e dos status. Escrita só
 * DONO/MASTER.
 *
 * @param {import('fastify').FastifyInstance} app
 */
export function registrarRotasPipelines(app) {
  const apenasGestao = { preHandler: requireRole(PAPEIS_GESTAO) };

  app.get('/crm/configuracoes/pipelines', async (req, reply) => {
    const { tenantId, role } = req.tenantContext;

    return sendSuccess(reply, await listarPipelines(tenantId, { papel: role }));
  });

  app.post('/crm/configuracoes/pipelines', apenasGestao, async (req, reply) => {
    const { tenantId } = req.tenantContext;
    const dados = criarPipelineBodySchema.parse(req.body);

    return sendSuccess(reply, await criarPipeline(tenantId, dados), HTTP_STATUS.CREATED);
  });

  app.put('/crm/configuracoes/pipelines/:id', apenasGestao, async (req, reply) => {
    const { tenantId } = req.tenantContext;
    const { id } = pipelineParamSchema.parse(req.params);
    const mudancas = atualizarPipelineBodySchema.parse(req.body);

    return sendSuccess(reply, await atualizarPipeline(tenantId, id, mudancas));
  });

  app.delete('/crm/configuracoes/pipelines/:id', apenasGestao, async (req, reply) => {
    const { tenantId } = req.tenantContext;
    const { id } = pipelineParamSchema.parse(req.params);

    return sendSuccess(reply, await excluirPipeline(tenantId, id));
  });

  app.post('/crm/configuracoes/pipelines/:id/status', apenasGestao, async (req, reply) => {
    const { tenantId } = req.tenantContext;
    const { id } = pipelineParamSchema.parse(req.params);
    const dados = criarOpcaoBodySchema.parse(req.body);

    return sendSuccess(reply, await criarStatus(tenantId, id, dados), HTTP_STATUS.CREATED);
  });

  app.put('/crm/configuracoes/pipelines/:id/status/ordem', apenasGestao, async (req, reply) => {
    const { tenantId } = req.tenantContext;
    const { id } = pipelineParamSchema.parse(req.params);
    const { ids } = reordenarListaBodySchema.parse(req.body);

    return sendSuccess(reply, await reordenarStatus(tenantId, id, ids));
  });

  app.put('/crm/configuracoes/pipelines/:id/status/:opcaoId', apenasGestao, async (req, reply) => {
    const { tenantId } = req.tenantContext;
    const { id, opcaoId } = statusParamSchema.parse(req.params);
    const mudancas = atualizarOpcaoBodySchema.parse(req.body);

    return sendSuccess(reply, await atualizarStatus(tenantId, id, opcaoId, mudancas));
  });

  app.delete(
    '/crm/configuracoes/pipelines/:id/status/:opcaoId',
    apenasGestao,
    async (req, reply) => {
      const { tenantId } = req.tenantContext;
      const { id, opcaoId } = statusParamSchema.parse(req.params);

      return sendSuccess(reply, await excluirStatus(tenantId, id, opcaoId));
    },
  );
}
