import { exigirFeature } from '#core/tenant/feature-flags.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { sendSuccess } from '#shared/http/response.js';
import { CRM_FEATURES, OPCOES_CATEGORIA_EVENTO } from '../constants.js';
import {
  atividadeParamSchema,
  criarAtividadeBodySchema,
  editarAtividadeBodySchema,
  historicoQuerySchema,
} from '../schemas/atividades.schema.js';
import { leadIdParamSchema } from '../schemas/leads.schema.js';
import {
  editarAtividade,
  listarAtividades,
  listarTiposDeAtividade,
  registrarAtividade,
  removerAtividade,
} from '../services/atividades.service.js';
import { listarHistorico } from '../services/historico.service.js';

/**
 * CONTROLLER: atividades e histórico do lead (M6). HTTP fino. Atrás da
 * flag `crm.atividades`; qualquer papel. O histórico é gravado sempre,
 * com ou sem a flag — ela só libera a leitura (e as atividades).
 *
 * Timeline (M16, flag `crm.timeline`): `?categorias=` no histórico e
 * `GET /crm/historico/categorias` (`[{ key, label }]`) pro seletor.
 *
 * @param {import('fastify').FastifyInstance} app
 */
export function registrarRotasAtividades(app) {
  const comFlag = { preHandler: [exigirFeature(CRM_FEATURES.ATIVIDADES)] };

  // Tipos pro formulário — não depende de `crm.listas` (a tela de Listas).
  app.get('/crm/atividades/tipos', comFlag, async (req, reply) => {
    const { tenantId } = req.tenantContext;
    return sendSuccess(reply, await listarTiposDeAtividade(tenantId));
  });

  app.get('/crm/leads/:id/atividades', comFlag, async (req, reply) => {
    const { tenantId } = req.tenantContext;
    const { id: leadId } = leadIdParamSchema.parse(req.params);
    return sendSuccess(reply, await listarAtividades(tenantId, leadId));
  });

  app.post('/crm/leads/:id/atividades', comFlag, async (req, reply) => {
    const { tenantId, userId } = req.tenantContext;
    const { id: leadId } = leadIdParamSchema.parse(req.params);
    const body = criarAtividadeBodySchema.parse(req.body);
    return sendSuccess(reply, await registrarAtividade(tenantId, leadId, body, userId), HTTP_STATUS.CREATED);
  });

  app.put('/crm/leads/:id/atividades/:atividadeId', comFlag, async (req, reply) => {
    const { tenantId } = req.tenantContext;
    const { id: leadId, atividadeId } = atividadeParamSchema.parse(req.params);
    const body = editarAtividadeBodySchema.parse(req.body);
    return sendSuccess(reply, await editarAtividade(tenantId, leadId, atividadeId, body));
  });

  app.delete('/crm/leads/:id/atividades/:atividadeId', comFlag, async (req, reply) => {
    const { tenantId } = req.tenantContext;
    const { id: leadId, atividadeId } = atividadeParamSchema.parse(req.params);
    return sendSuccess(reply, await removerAtividade(tenantId, leadId, atividadeId));
  });

  app.get('/crm/historico/categorias', { preHandler: [exigirFeature(CRM_FEATURES.TIMELINE)] }, async (req, reply) =>
    sendSuccess(reply, OPCOES_CATEGORIA_EVENTO),
  );

  app.get('/crm/leads/:id/historico', comFlag, async (req, reply) => {
    const { tenantId, role } = req.tenantContext;
    const { id: leadId } = leadIdParamSchema.parse(req.params);
    const paginacao = historicoQuerySchema.parse(req.query);
    return sendSuccess(reply, await listarHistorico(tenantId, leadId, paginacao, { papel: role }));
  });
}
