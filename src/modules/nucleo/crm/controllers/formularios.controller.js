import { requireRole } from '#core/auth/rbac.js';
import { exigirFeature } from '#core/tenant/feature-flags.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { sendSuccess } from '#shared/http/response.js';
import { CRM_FEATURES, PAPEIS_GESTAO } from '../constants.js';
import {
  criarFormularioBodySchema,
  editarFormularioBodySchema,
  formularioParamSchema,
  versaoParamSchema,
} from '../schemas/formularios.schema.js';
import {
  criarFormulario,
  editarFormulario,
  listarCamposElegiveis,
  listarFormularios,
  obterFormulario,
  obterVersao,
  publicarFormulario,
} from '../services/formularios.service.js';

/**
 * CONTROLLER: Configurações → Formulários (FM1). HTTP fino. Tudo atrás da
 * flag `crm.formularios` e só de gestão: montar formulário é configuração.
 * A ficha (gerar link, ver respostas) ganha rotas próprias na FM2.
 *
 * @param {import('fastify').FastifyInstance} app
 */
export function registrarRotasFormularios(app) {
  const gestao = {
    preHandler: [exigirFeature(CRM_FEATURES.FORMULARIOS), requireRole(PAPEIS_GESTAO)],
  };
  const base = '/crm/configuracoes/formularios';

  app.get(base, gestao, async (req, reply) => {
    const { tenantId } = req.tenantContext;
    return sendSuccess(reply, await listarFormularios(tenantId));
  });

  app.get(`${base}/campos-elegiveis`, gestao, async (req, reply) => {
    const { tenantId } = req.tenantContext;
    return sendSuccess(reply, await listarCamposElegiveis(tenantId));
  });

  app.post(base, gestao, async (req, reply) => {
    const { tenantId } = req.tenantContext;
    const dados = criarFormularioBodySchema.parse(req.body);
    return sendSuccess(reply, await criarFormulario(tenantId, dados), HTTP_STATUS.CREATED);
  });

  app.get(`${base}/:id`, gestao, async (req, reply) => {
    const { tenantId } = req.tenantContext;
    const { id } = formularioParamSchema.parse(req.params);
    return sendSuccess(reply, await obterFormulario(tenantId, id));
  });

  app.put(`${base}/:id`, gestao, async (req, reply) => {
    const { tenantId } = req.tenantContext;
    const { id } = formularioParamSchema.parse(req.params);
    const mudancas = editarFormularioBodySchema.parse(req.body);
    return sendSuccess(reply, await editarFormulario(tenantId, id, mudancas));
  });

  app.post(`${base}/:id/publicar`, gestao, async (req, reply) => {
    const { tenantId, userId } = req.tenantContext;
    const { id } = formularioParamSchema.parse(req.params);
    return sendSuccess(reply, await publicarFormulario(tenantId, id, userId), HTTP_STATUS.CREATED);
  });

  app.get(`${base}/:id/versoes/:versaoId`, gestao, async (req, reply) => {
    const { tenantId } = req.tenantContext;
    const { id, versaoId } = versaoParamSchema.parse(req.params);
    return sendSuccess(reply, await obterVersao(tenantId, id, versaoId));
  });
}
