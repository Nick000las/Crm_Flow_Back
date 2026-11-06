import { exigirFeature } from '#core/tenant/feature-flags.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { sendSuccess } from '#shared/http/response.js';
import { KANBAN_FEATURES } from '../constants.js';
import {
  buscarCardsBodySchema,
  cardParamsSchema,
  criarCardBodySchema,
  moverCardBodySchema,
  quadroParamsSchema,
  resumoColunaBodySchema,
} from '../schemas/quadro.schema.js';
import {
  criarCard,
  listarAcoes,
  listarCards,
  listarColunas,
  moverCard,
  resumirColuna,
} from '../services/quadro-entidade.service.js';

/**
 * CONTROLLER: quadros de entidade (M2), atrás de `kanban_universal.quadros_entidade`.
 * Rotas próprias porque `quadroRef` é opaco (as de `/kanban/boards` exigem
 * uuid) e o quadro não tem linha em `boards`.
 *
 * @param {import('fastify').FastifyInstance} app
 */
export function registrarRotasQuadros(app) {
  const comFlag = { preHandler: [exigirFeature(KANBAN_FEATURES.QUADROS_ENTIDADE)] };
  const QUADRO = '/kanban/quadros/:boardType/:quadroRef';

  app.get(`${QUADRO}/colunas`, comFlag, async (req, reply) => {
    const quadro = quadroParamsSchema.parse(req.params);
    return sendSuccess(reply, await listarColunas(req.tenantContext, quadro));
  });

  app.post(`${QUADRO}/resumo`, comFlag, async (req, reply) => {
    const quadro = quadroParamsSchema.parse(req.params);
    const body = resumoColunaBodySchema.parse(req.body);
    return sendSuccess(reply, await resumirColuna(req.tenantContext, quadro, body));
  });

  app.post(`${QUADRO}/cards/busca`, comFlag, async (req, reply) => {
    const quadro = quadroParamsSchema.parse(req.params);
    const body = buscarCardsBodySchema.parse(req.body);
    return sendSuccess(reply, await listarCards(req.tenantContext, quadro, body));
  });

  app.post(`${QUADRO}/cards`, comFlag, async (req, reply) => {
    const quadro = quadroParamsSchema.parse(req.params);
    const body = criarCardBodySchema.parse(req.body);
    return sendSuccess(
      reply,
      await criarCard(req.tenantContext, quadro, body),
      HTTP_STATUS.CREATED,
    );
  });

  app.get(`${QUADRO}/cards/:entidadeId/acoes`, comFlag, async (req, reply) => {
    const card = cardParamsSchema.parse(req.params);
    return sendSuccess(reply, await listarAcoes(req.tenantContext, card));
  });

  app.patch(`${QUADRO}/cards/:entidadeId/mover`, comFlag, async (req, reply) => {
    const card = cardParamsSchema.parse(req.params);
    const body = moverCardBodySchema.parse(req.body);
    return sendSuccess(reply, await moverCard(req.tenantContext, card, body));
  });
}
