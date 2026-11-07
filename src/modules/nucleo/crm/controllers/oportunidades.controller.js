import { HTTP_STATUS } from '#shared/constants/index.js';
import { sendSuccess } from '#shared/http/response.js';
import { leadIdParamSchema } from '../schemas/leads.schema.js';
import {
  criarOportunidadeBodySchema,
  editarOportunidadeBodySchema,
  listarOportunidadesQuerySchema,
  mudarStatusBodySchema,
  oportunidadeParamSchema,
} from '../schemas/oportunidades.schema.js';
import {
  criarOportunidade,
  definirArquivamentoDaOportunidade,
  definirLixeiraDaOportunidade,
  editarOportunidade,
  listarOportunidadesDaPessoa,
  mudarStatusDaOportunidade,
} from '../services/oportunidades.service.js';

/**
 * CONTROLLER: aba Oportunidades da ficha (M2.5, F6). HTTP fino. O papel do token
 * vai pro service: campo oculto não sai, e campo "só ver" no payload é 403.
 *
 * @param {import('fastify').FastifyInstance} app
 */
export function registrarRotasOportunidades(app) {
  app.get('/crm/leads/:id/oportunidades', async (req, reply) => {
    const { tenantId, role } = req.tenantContext;
    const { id } = leadIdParamSchema.parse(req.params);
    const { situacao } = listarOportunidadesQuerySchema.parse(req.query);
    return sendSuccess(
      reply,
      await listarOportunidadesDaPessoa(tenantId, id, {
        papel: role,
        daLixeira: situacao === 'lixeira',
      }),
    );
  });

  app.post('/crm/leads/:id/oportunidades', async (req, reply) => {
    const { tenantId, userId, role } = req.tenantContext;
    const { id } = leadIdParamSchema.parse(req.params);
    const dados = criarOportunidadeBodySchema.parse(req.body);
    return sendSuccess(
      reply,
      await criarOportunidade(tenantId, id, dados, userId, { papel: role }),
      HTTP_STATUS.CREATED,
    );
  });

  app.put('/crm/oportunidades/:id', async (req, reply) => {
    const { tenantId, userId, role } = req.tenantContext;
    const { id } = oportunidadeParamSchema.parse(req.params);
    const dados = editarOportunidadeBodySchema.parse(req.body);
    return sendSuccess(
      reply,
      await editarOportunidade(tenantId, id, dados, userId, { papel: role }),
    );
  });

  // Arquivar e lixeira (P9): o card sai do quadro e volta se restaurado.
  const situacoes = [
    ['post', 'arquivar', (t, id, u, a) => definirArquivamentoDaOportunidade(t, id, true, u, a)],
    ['post', 'desarquivar', (t, id, u, a) => definirArquivamentoDaOportunidade(t, id, false, u, a)],
    ['post', 'excluir', (t, id, u, a) => definirLixeiraDaOportunidade(t, id, true, u, a)],
    ['post', 'restaurar', (t, id, u, a) => definirLixeiraDaOportunidade(t, id, false, u, a)],
  ];
  for (const [metodo, acao, executar] of situacoes) {
    app[metodo](`/crm/oportunidades/:id/${acao}`, async (req, reply) => {
      const { tenantId, userId, role } = req.tenantContext;
      const { id } = oportunidadeParamSchema.parse(req.params);
      return sendSuccess(reply, await executar(tenantId, id, userId, { papel: role }));
    });
  }

  app.patch('/crm/oportunidades/:id/status', async (req, reply) => {
    const { tenantId, userId, role } = req.tenantContext;
    const { id } = oportunidadeParamSchema.parse(req.params);
    const dados = mudarStatusBodySchema.parse(req.body);
    return sendSuccess(
      reply,
      await mudarStatusDaOportunidade(tenantId, id, dados, userId, { papel: role }),
    );
  });
}
