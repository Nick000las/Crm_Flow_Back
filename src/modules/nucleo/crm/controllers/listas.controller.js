import { requireRole } from '#core/auth/rbac.js';
import { exigirFeature } from '#core/tenant/feature-flags.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { sendSuccess } from '#shared/http/response.js';
import { CRM_FEATURES, PAPEIS_GESTAO } from '../constants.js';
import {
  atualizarOpcaoBodySchema,
  criarOpcaoBodySchema,
  opcaoParamSchema,
  reordenarListaBodySchema,
  tipoListaParamSchema,
} from '../schemas/listas.schema.js';
import {
  atualizarOpcao,
  criarOpcao,
  excluirOpcao,
  listarListas,
  reordenarLista,
} from '../services/listas.service.js';

/**
 * CONTROLLER: Configurações → Listas (M3). HTTP fino.
 *
 * Atrás da flag `crm.listas` (rollout da subseção). Leitura liberada a
 * qualquer papel do tenant; escrita só DONO/MASTER — o papel é conferido
 * antes da flag, pra OPERADOR receber sempre o mesmo 403 `FORBIDDEN`.
 * As opções que formulário/filtro usam NÃO dependem da flag: vêm em
 * `GET /crm/leads/fields` (`opcoes` + `opcoesLista`).
 *
 * @param {import('fastify').FastifyInstance} app
 */
export function registrarRotasListas(app) {
  const comFlag = exigirFeature(CRM_FEATURES.LISTAS);
  const leitura = { preHandler: [comFlag] };
  const escrita = { preHandler: [requireRole(PAPEIS_GESTAO), comFlag] };

  app.get('/crm/configuracoes/listas', leitura, async (req, reply) => {
    const { tenantId } = req.tenantContext;
    return sendSuccess(reply, await listarListas(tenantId));
  });

  app.post('/crm/configuracoes/listas/:tipo', escrita, async (req, reply) => {
    const { tenantId } = req.tenantContext;
    const { tipo } = tipoListaParamSchema.parse(req.params);
    const dados = criarOpcaoBodySchema.parse(req.body);
    return sendSuccess(reply, await criarOpcao(tenantId, tipo, dados), HTTP_STATUS.CREATED);
  });

  app.put('/crm/configuracoes/listas/:tipo/ordem', escrita, async (req, reply) => {
    const { tenantId } = req.tenantContext;
    const { tipo } = tipoListaParamSchema.parse(req.params);
    const { ids } = reordenarListaBodySchema.parse(req.body);
    return sendSuccess(reply, await reordenarLista(tenantId, tipo, ids));
  });

  app.put('/crm/configuracoes/listas/:tipo/:id', escrita, async (req, reply) => {
    const { tenantId } = req.tenantContext;
    const { tipo, id } = opcaoParamSchema.parse(req.params);
    const mudancas = atualizarOpcaoBodySchema.parse(req.body);
    return sendSuccess(reply, await atualizarOpcao(tenantId, tipo, id, mudancas));
  });

  app.delete('/crm/configuracoes/listas/:tipo/:id', escrita, async (req, reply) => {
    const { tenantId } = req.tenantContext;
    const { tipo, id } = opcaoParamSchema.parse(req.params);
    return sendSuccess(reply, await excluirOpcao(tenantId, tipo, id));
  });
}
