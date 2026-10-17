import { exigirFeature } from '#core/tenant/feature-flags.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { sendSuccess } from '#shared/http/response.js';
import {
  buscarLeadFormatado,
  registrarNovoLead,
  atualizarLeadExistente,
  listarCamposDoTenant,
  pesquisarLeads,
} from '../services/leads.service.js';
import {
  criarLeadBodySchema,
  atualizarLeadBodySchema,
  leadIdParamSchema,
} from '../schemas/leads.schema.js';
import { pesquisarLeadsBodySchema, listarLeadsQuerySchema } from '../schemas/leads-search.schema.js';
import { contextoCamposQuerySchema } from '../schemas/configuracoes.schema.js';
import { arquivarLead, desarquivarLead, excluirLead, restaurarLead } from '../services/arquivo.service.js';
import { CRM_FEATURES } from '../constants.js';

/**
 * CONTROLLER: HTTP fino. NUNCA importa nada de `adapters/`.
 * @param {import('fastify').FastifyInstance} app
 */
export function registrarRotasLeads(app) {
  app.get('/crm/leads', async (req, reply) => {
    const { tenantId } = req.tenantContext;
    // Mesma implementação do /search (sem filtro), paginada.
    const paginacao = listarLeadsQuerySchema.parse(req.query);
    return sendSuccess(reply, await pesquisarLeads(tenantId, { filtros: [], paginacao }));
  });

  app.post('/crm/leads', async (req, reply) => {
    const { tenantId, userId } = req.tenantContext;
    const body = criarLeadBodySchema.parse(req.body);
    const lead = await registrarNovoLead(tenantId, body, userId);
    return sendSuccess(reply, lead, HTTP_STATUS.CREATED);
  });

  // Campos ativos do tenant (Camada 1 + Camada 2 visível + Camada 3), fonte
  // única pra formulário, filtro e mapeamento de import/export.
  // `?contexto=create_form|detail|table|filter` (M2) devolve só os visíveis
  // naquela tela; sem ele, todos os que aparecem em algum contexto.
  // Registrada antes de `/crm/leads/:id` só por legibilidade — rota
  // estática já tem precedência no roteador do Fastify.
  app.get('/crm/leads/fields', async (req, reply) => {
    const { tenantId } = req.tenantContext;
    const { contexto } = contextoCamposQuerySchema.parse(req.query);
    return sendSuccess(reply, await listarCamposDoTenant(tenantId, contexto));
  });

  // POST (não GET): filtro combinado com campos customizados não cabe bem
  // em query string (docs/crm/plano-campos-filtros-import-export.md §2.2).
  app.post('/crm/leads/search', async (req, reply) => {
    const { tenantId } = req.tenantContext;
    const body = pesquisarLeadsBodySchema.parse(req.body ?? {});
    return sendSuccess(reply, await pesquisarLeads(tenantId, body));
  });

  app.get('/crm/leads/:id', async (req, reply) => {
    const { tenantId } = req.tenantContext;
    const { id: leadId } = leadIdParamSchema.parse(req.params);
    return sendSuccess(reply, await buscarLeadFormatado(tenantId, leadId));
  });

  app.put('/crm/leads/:id', async (req, reply) => {
    const { tenantId, userId } = req.tenantContext;
    const { id: leadId } = leadIdParamSchema.parse(req.params);
    const body = atualizarLeadBodySchema.parse(req.body);
    return sendSuccess(reply, await atualizarLeadExistente(tenantId, leadId, body, userId));
  });

  // "Excluir" é sempre lixeira (M5), com ou sem a flag: sem ela só não há
  // tela pra restaurar, e a purga apaga depois do prazo.
  app.delete('/crm/leads/:id', async (req, reply) => {
    const { tenantId, userId } = req.tenantContext;
    const { id: leadId } = leadIdParamSchema.parse(req.params);
    return sendSuccess(reply, await excluirLead(tenantId, leadId, userId));
  });

  // Arquivo e lixeira (M5), atrás de `crm.arquivo`. Respondem o lead formatado.
  const comArquivo = { preHandler: [exigirFeature(CRM_FEATURES.ARQUIVO)] };
  const acoes = [
    ['arquivar', arquivarLead],
    ['desarquivar', desarquivarLead],
    ['restaurar', restaurarLead],
  ];
  for (const [acao, executar] of acoes) {
    app.post(`/crm/leads/:id/${acao}`, comArquivo, async (req, reply) => {
      const { tenantId, userId } = req.tenantContext;
      const { id: leadId } = leadIdParamSchema.parse(req.params);
      return sendSuccess(reply, await executar(tenantId, leadId, userId));
    });
  }
}
