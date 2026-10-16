import { requireRole } from '#core/auth/rbac.js';
import { sendSuccess } from '#shared/http/response.js';
import { PAPEIS_GESTAO } from '../constants.js';
import {
  atualizarCampoBodySchema,
  campoIdParamSchema,
  reordenarCamposBodySchema,
} from '../schemas/configuracoes.schema.js';
import {
  atualizarConfiguracaoCampo,
  listarConfiguracaoCampos,
  reordenarCampos,
  restaurarOrdemPadrao,
} from '../services/configuracoes-campos.service.js';

/**
 * CONTROLLER: área Configurações → Campos (M2). HTTP fino.
 *
 * Sem feature flag: é a única tela de configuração de campos (a antiga foi
 * removida). Leitura liberada a qualquer papel do tenant; escrita só
 * DONO/MASTER.
 *
 * @param {import('fastify').FastifyInstance} app
 */
export function registrarRotasConfiguracoes(app) {
  const escrita = { preHandler: requireRole(PAPEIS_GESTAO) };

  app.get('/crm/configuracoes/campos', async (req, reply) => {
    const { tenantId } = req.tenantContext;
    return sendSuccess(reply, await listarConfiguracaoCampos(tenantId));
  });

  app.put('/crm/configuracoes/campos/ordem', escrita, async (req, reply) => {
    const { tenantId } = req.tenantContext;
    const { ids } = reordenarCamposBodySchema.parse(req.body);
    return sendSuccess(reply, await reordenarCampos(tenantId, ids));
  });

  app.post('/crm/configuracoes/campos/ordem/padrao', escrita, async (req, reply) => {
    const { tenantId } = req.tenantContext;
    return sendSuccess(reply, await restaurarOrdemPadrao(tenantId));
  });

  app.put('/crm/configuracoes/campos/:id', escrita, async (req, reply) => {
    const { tenantId } = req.tenantContext;
    const { id } = campoIdParamSchema.parse(req.params);
    const mudancas = atualizarCampoBodySchema.parse(req.body);
    return sendSuccess(reply, await atualizarConfiguracaoCampo(tenantId, id, mudancas));
  });
}
