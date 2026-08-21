import { z } from 'zod';
import { BRAZIL_PHONE, HTTP_STATUS, TEXT_LIMITS } from '#shared/constants/index.js';
import { sendSuccess } from '#shared/http/response.js';
import { listarLeadsFormatados, registrarNovoLead } from '../services/leads.service.js';

const criarLeadBodySchema = z.object({
  nome: z
    .string({
      required_error: 'Informe o nome do lead',
      invalid_type_error: 'Informe um nome válido',
    })
    .trim()
    .min(TEXT_LIMITS.NON_EMPTY_MIN_LENGTH, 'Informe o nome do lead'),
  telefone: z
    .string({
      required_error: 'Informe o telefone',
      invalid_type_error: 'Informe um telefone válido',
    })
    .min(BRAZIL_PHONE.LANDLINE_LENGTH, 'Informe um telefone válido'),
  funilEstagioId: z
    .string({
      required_error: 'Informe o estágio do funil',
      invalid_type_error: 'Informe um estágio de funil válido',
    })
    .uuid('Informe um estágio de funil válido'),
});

/**
 * CONTROLLER: HTTP fino. NUNCA importa nada de `adapters/`.
 * @param {import('fastify').FastifyInstance} app
 */
export function registrarRotasLeads(app) {
  app.get('/crm/leads', async (req, reply) => {
    const { tenantId } = req.tenantContext;
    return sendSuccess(reply, await listarLeadsFormatados(tenantId));
  });

  app.post('/crm/leads', async (req, reply) => {
    const { tenantId } = req.tenantContext;
    const body = criarLeadBodySchema.parse(req.body);
    const lead = await registrarNovoLead(tenantId, body);
    return sendSuccess(reply, lead, HTTP_STATUS.CREATED);
  });
}
