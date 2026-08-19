import { z } from 'zod';
import { listarLeadsFormatados, registrarNovoLead } from '../services/leads.service.js';

const criarLeadBodySchema = z.object({
  nome: z.string().min(1),
  telefone: z.string().min(10),
  funilEstagioId: z.string().uuid(),
});

/**
 * CONTROLLER: HTTP fino. NUNCA importa nada de `adapters/`.
 * @param {import('fastify').FastifyInstance} app
 */
export function registrarRotasLeads(app) {
  app.get('/crm/leads', async (req, reply) => {
    const { tenantId } = req.tenantContext;
    return reply.send(await listarLeadsFormatados(tenantId));
  });

  app.post('/crm/leads', async (req, reply) => {
    const { tenantId } = req.tenantContext;
    const body = criarLeadBodySchema.parse(req.body);
    const lead = await registrarNovoLead(tenantId, body);
    return reply.code(201).send(lead);
  });
}
