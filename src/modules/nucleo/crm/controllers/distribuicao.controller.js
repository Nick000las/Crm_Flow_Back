import { requireRole } from '#core/auth/rbac.js';
import { exigirFeature } from '#core/tenant/feature-flags.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { sendSuccess } from '#shared/http/response.js';
import { CRM_FEATURES, PAPEIS_GESTAO } from '../constants.js';
import { grupoBodySchema, grupoIdParamSchema, salvarDistribuicaoBodySchema } from '../schemas/distribuicao.schema.js';
import {
  criarGrupo,
  editarGrupo,
  excluirGrupo,
  obterConfigDistribuicao,
  salvarConfigDistribuicao,
} from '../services/distribuicao.service.js';

/**
 * CONTROLLER: Configurações → distribuição automática (M12). HTTP fino.
 * Atrás da flag `crm.distribuicao`. Leitura pra qualquer papel (o
 * formulário de lead mostra "Automático" no responsável quando está
 * ligada); escrita só DONO/MASTER, papel conferido antes da flag.
 *
 * - `GET`/`PUT /crm/configuracoes/distribuicao`: `{ ativo, fallback,
 *   regras: [{ id, nome, ativo, condicoes: [{ campoId, operador, valor? }],
 *   destino: { tipo: 'usuario' | 'grupo', id } }] }` (+ `grupos` e
 *   `configurado` no GET). O PUT manda tudo; a ordem é a de avaliação.
 * - `POST`/`PUT`/`DELETE /crm/configuracoes/distribuicao/grupos(/:id)`:
 *   `{ nome, membros: [usuarioId] }`. Grupo destino de regra → 409 no DELETE.
 *
 * @param {import('fastify').FastifyInstance} app
 */
export function registrarRotasDistribuicao(app) {
  const comFlag = exigirFeature(CRM_FEATURES.DISTRIBUICAO);
  const apenasGestao = { preHandler: [requireRole(PAPEIS_GESTAO), comFlag] };

  app.get('/crm/configuracoes/distribuicao', { preHandler: [comFlag] }, async (req, reply) => {
    const { tenantId } = req.tenantContext;
    return sendSuccess(reply, await obterConfigDistribuicao(tenantId));
  });

  app.put('/crm/configuracoes/distribuicao', apenasGestao, async (req, reply) => {
    const { tenantId } = req.tenantContext;
    const body = salvarDistribuicaoBodySchema.parse(req.body);
    return sendSuccess(reply, await salvarConfigDistribuicao(tenantId, body));
  });

  app.post('/crm/configuracoes/distribuicao/grupos', apenasGestao, async (req, reply) => {
    const { tenantId } = req.tenantContext;
    const body = grupoBodySchema.parse(req.body);
    return sendSuccess(reply, await criarGrupo(tenantId, body), HTTP_STATUS.CREATED);
  });

  app.put('/crm/configuracoes/distribuicao/grupos/:id', apenasGestao, async (req, reply) => {
    const { tenantId } = req.tenantContext;
    const { id } = grupoIdParamSchema.parse(req.params);
    const body = grupoBodySchema.parse(req.body);
    return sendSuccess(reply, await editarGrupo(tenantId, id, body));
  });

  app.delete('/crm/configuracoes/distribuicao/grupos/:id', apenasGestao, async (req, reply) => {
    const { tenantId } = req.tenantContext;
    const { id } = grupoIdParamSchema.parse(req.params);
    return sendSuccess(reply, await excluirGrupo(tenantId, id));
  });
}
