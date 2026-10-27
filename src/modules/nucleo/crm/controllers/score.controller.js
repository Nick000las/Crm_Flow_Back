import { requireRole } from '#core/auth/rbac.js';
import { exigirFeature } from '#core/tenant/feature-flags.js';
import { sendSuccess } from '#shared/http/response.js';
import { CRM_FEATURES, PAPEIS_GESTAO } from '../constants.js';
import { salvarScoreBodySchema } from '../schemas/score.schema.js';
import { obterConfigScore, recalcularTodos, salvarConfigScore } from '../services/score.service.js';

/**
 * CONTROLLER: Configurações → pontuação de leads (M14). HTTP fino. Atrás
 * da flag `crm.score`. Leitura pra qualquer papel (a tabela pinta a faixa
 * do score com as cores daqui); escrita só DONO/MASTER, papel antes da flag.
 *
 * - `GET /crm/configuracoes/score`: `{ regras: [{ id, nome, ativo, pontos,
 *   condicoes }], faixas: [{ chave, rotulo, minimo, maximo, cor }],
 *   faixasConfiguradas, recalculo: { total, processados, emAndamento,
 *   concluidoEm } | null }`.
 * - `PUT`: `{ regras, faixas }` inteiros; recalcula todos os leads antes de
 *   responder (em lotes; o progresso aparece no GET enquanto roda).
 * - `POST /crm/configuracoes/score/recalcular`: recalcula sem mudar regra.
 *
 * @param {import('fastify').FastifyInstance} app
 */
export function registrarRotasScore(app) {
  const comFlag = exigirFeature(CRM_FEATURES.SCORE);
  const apenasGestao = { preHandler: [requireRole(PAPEIS_GESTAO), comFlag] };

  app.get('/crm/configuracoes/score', { preHandler: [comFlag] }, async (req, reply) => {
    const { tenantId } = req.tenantContext;
    return sendSuccess(reply, await obterConfigScore(tenantId));
  });

  app.put('/crm/configuracoes/score', apenasGestao, async (req, reply) => {
    const { tenantId } = req.tenantContext;
    const body = salvarScoreBodySchema.parse(req.body);
    return sendSuccess(reply, await salvarConfigScore(tenantId, body));
  });

  app.post('/crm/configuracoes/score/recalcular', apenasGestao, async (req, reply) => {
    const { tenantId } = req.tenantContext;
    return sendSuccess(reply, await recalcularTodos(tenantId));
  });
}
