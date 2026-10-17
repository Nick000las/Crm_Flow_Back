import { z } from 'zod';
import { authenticateHook } from '#core/auth/rbac.js';
import { listarNotificacoes, marcarComoLida, marcarTodasComoLidas } from '#core/notificacoes/notificacoes.js';
import { PAGINATION } from '#shared/constants/index.js';
import { sendSuccess } from '#shared/http/response.js';

const listarQuerySchema = z.object({
  pagina: z.coerce.number().int().min(PAGINATION.MIN_PAGE).default(PAGINATION.DEFAULT_PAGE),
  tamanho: z.coerce
    .number()
    .int()
    .min(PAGINATION.MIN_ITEMS_PER_PAGE)
    .max(PAGINATION.MAX_ITEMS_PER_PAGE)
    .default(PAGINATION.DEFAULT_ITEMS_PER_PAGE),
});

const idParamSchema = z.object({ id: z.string().uuid('Notificação inválida') });

/**
 * Notificações in-app do usuário logado (sino do shell). Do core, não de
 * um módulo: qualquer módulo gera (`#core/notificacoes`), e o usuário só
 * vê e marca as próprias — o usuário vem do token, nunca do cliente.
 *
 * @param {import('fastify').FastifyInstance} app
 */
export function registerNotificacoesRoutes(app) {
  const autenticada = { preHandler: authenticateHook };

  app.get('/notificacoes', autenticada, async (req, reply) => {
    const { tenantId, userId } = req.tenantContext;
    const paginacao = listarQuerySchema.parse(req.query ?? {});
    return sendSuccess(reply, await listarNotificacoes(tenantId, userId, paginacao));
  });

  app.post('/notificacoes/:id/lida', autenticada, async (req, reply) => {
    const { tenantId, userId } = req.tenantContext;
    const { id } = idParamSchema.parse(req.params);
    return sendSuccess(reply, await marcarComoLida(tenantId, userId, id));
  });

  app.post('/notificacoes/lidas', autenticada, async (req, reply) => {
    const { tenantId, userId } = req.tenantContext;
    return sendSuccess(reply, await marcarTodasComoLidas(tenantId, userId));
  });
}
