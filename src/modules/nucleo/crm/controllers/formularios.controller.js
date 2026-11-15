import { requireRole } from '#core/auth/rbac.js';
import { exigirFeature } from '#core/tenant/feature-flags.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { sendSuccess } from '#shared/http/response.js';
import { CRM_FEATURES, PAPEIS_GESTAO } from '../constants.js';
import {
  criarFormularioBodySchema,
  criarLinkBodySchema,
  editarFormularioBodySchema,
  formularioParamSchema,
  leadDoFormularioParamSchema,
  linkDoFormularioParamSchema,
  linkParamSchema,
  listarAlertasQuerySchema,
  alertaParamSchema,
  respostaParamSchema,
  versaoParamSchema,
} from '../schemas/formularios.schema.js';
import {
  criarLinkDoFormulario,
  listarFormulariosDisponiveis,
  listarLinksDaPessoa,
  revogarLink,
} from '../services/formulario-links.service.js';
import { listarAlertasDaPessoa, marcarVisto } from '../services/formulario-alertas.service.js';
import {
  listarRespostasDaPessoa,
  obterResposta,
} from '../services/formulario-respostas.service.js';
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
 * A ficha (FM2) tem rotas próprias, abertas a qualquer papel que veja a
 * pessoa: o hook de visibilidade (D4) vale para `/crm/leads/:id/...`.
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

  const comFlag = { preHandler: [exigirFeature(CRM_FEATURES.FORMULARIOS)] };

  app.get('/crm/formularios/disponiveis', comFlag, async (req, reply) => {
    const { tenantId } = req.tenantContext;
    return sendSuccess(reply, await listarFormulariosDisponiveis(tenantId));
  });

  app.get('/crm/leads/:id/formularios', comFlag, async (req, reply) => {
    const { tenantId } = req.tenantContext;
    const { id } = leadDoFormularioParamSchema.parse(req.params);
    return sendSuccess(reply, await listarLinksDaPessoa(tenantId, id));
  });

  app.post('/crm/leads/:id/formularios/:formId/link', comFlag, async (req, reply) => {
    const { tenantId, userId } = req.tenantContext;
    const { id, formId } = linkDoFormularioParamSchema.parse(req.params);
    const { oportunidadeId } = criarLinkBodySchema.parse(req.body ?? {});
    const resultado = await criarLinkDoFormulario(tenantId, id, formId, {
      oportunidadeId,
      usuarioId: userId,
    });
    return sendSuccess(reply, resultado, resultado.criado ? HTTP_STATUS.CREATED : HTTP_STATUS.OK);
  });

  app.post('/crm/leads/:id/formularios/links/:linkId/revogar', comFlag, async (req, reply) => {
    const { tenantId } = req.tenantContext;
    const { id, linkId } = linkParamSchema.parse(req.params);
    return sendSuccess(reply, await revogarLink(tenantId, id, linkId));
  });

  // FM4: "Ver respostas". Campo que o papel não vê sai oculto.
  app.get('/crm/leads/:id/formularios/respostas', comFlag, async (req, reply) => {
    const { tenantId } = req.tenantContext;
    const { id } = leadDoFormularioParamSchema.parse(req.params);
    return sendSuccess(reply, await listarRespostasDaPessoa(tenantId, id));
  });

  // FM5: alertas no topo da ficha, até cada usuário marcar o seu como visto.
  app.get('/crm/leads/:id/formularios/alertas', comFlag, async (req, reply) => {
    const { tenantId, userId, role } = req.tenantContext;
    const { id } = leadDoFormularioParamSchema.parse(req.params);
    const opcoes = listarAlertasQuerySchema.parse(req.query ?? {});
    return sendSuccess(reply, await listarAlertasDaPessoa(tenantId, id, { userId, role }, opcoes));
  });

  app.post('/crm/leads/:id/formularios/alertas/:alertaId/visto', comFlag, async (req, reply) => {
    const { tenantId, userId } = req.tenantContext;
    const { id, alertaId } = alertaParamSchema.parse(req.params);
    return sendSuccess(reply, await marcarVisto(tenantId, id, alertaId, userId));
  });

  app.get('/crm/leads/:id/formularios/respostas/:respostaId', comFlag, async (req, reply) => {
    const { tenantId, role } = req.tenantContext;
    const { id, respostaId } = respostaParamSchema.parse(req.params);
    return sendSuccess(reply, await obterResposta(tenantId, id, respostaId, role));
  });
}
