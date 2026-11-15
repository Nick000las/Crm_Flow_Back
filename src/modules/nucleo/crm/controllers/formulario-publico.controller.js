import { AppError } from '#core/errors/app-error.js';

import { HTTP_STATUS } from '#shared/constants/index.js';
import { ERROR_CODES } from '#shared/http/error-codes.js';
import { sendSuccess } from '#shared/http/response.js';
import { LIMITE_POR_LINK, ROTA_PUBLICA_FORMULARIO } from '../constants.js';
import { enviarRespostaBodySchema } from '../schemas/formularios.schema.js';
import {
  abrirFormularioPublico,
  marcarFormularioAberto,
} from '../services/formulario-publico.service.js';
import { enviarResposta } from '../services/formulario-respostas.service.js';
import { hashDoToken } from '../services/token-formulario.service.js';

/** O navegador fica na resposta só para auditoria; além disso, é ruído. */
const LIMITE_USER_AGENT = 500;

/**
 * Rotas sem login da página do formulário (FM3), sob `/public`
 * (`Module.registerPublicRoutes`). O app já põe o limite por IP e os
 * cabeçalhos de privacidade; aqui entra o limite por link. A chave do limite
 * é o hash do token, nunca o token, e o log leva só o id do link.
 *
 * @param {import('fastify').FastifyInstance} app
 */
export function registrarRotasPublicasFormularios(app) {
  // Checagem manual: o `rateLimit()` de rota seria pulado, porque o plugin
  // marca o pedido depois do limite por IP e não roda um segundo limitador.
  const checarLink = app.createRateLimit({
    max: LIMITE_POR_LINK.MAX,
    timeWindow: LIMITE_POR_LINK.JANELA,
    keyGenerator: (request) =>
      `link-${hashDoToken(String(/** @type {any} */ (request.params).token)).toString('hex')}`,
  });
  /** @param {import('fastify').FastifyRequest} req @param {import('fastify').FastifyReply} reply */
  const porLink = async (req, reply) => {
    const limite = await checarLink(req);
    if (!limite.isAllowed && limite.isExceeded) {
      reply.header('Retry-After', String(limite.ttlInSeconds));
      throw new AppError({
        statusCode: HTTP_STATUS.TOO_MANY_REQUESTS,
        code: ERROR_CODES.RATE_LIMITED,
        message: 'Muitas tentativas neste link. Tente de novo em instantes.',
      });
    }
  };

  app.get(ROTA_PUBLICA_FORMULARIO, { preHandler: porLink }, async (req, reply) => {
    const { linkId, resposta } = await abrirFormularioPublico(
      /** @type {any} */ (req.params).token,
    );
    req.log.info({ formLinkId: linkId }, 'Formulário público lido');
    return sendSuccess(reply, resposta);
  });

  app.post(`${ROTA_PUBLICA_FORMULARIO}/aberto`, { preHandler: porLink }, async (req, reply) => {
    const linkId = await marcarFormularioAberto(/** @type {any} */ (req.params).token);
    req.log.info({ formLinkId: linkId }, 'Formulário público aberto');
    return sendSuccess(reply, { aberto: true });
  });

  // FM4. O log leva só os ids: nunca o que a pessoa respondeu.
  app.post(`${ROTA_PUBLICA_FORMULARIO}/respostas`, { preHandler: porLink }, async (req, reply) => {
    const corpo = enviarRespostaBodySchema.parse(req.body ?? {});
    const agente = req.headers['user-agent'];
    const { linkId, respostaId } = await enviarResposta(
      /** @type {any} */ (req.params).token,
      corpo,
      {
        ip: req.ip ?? null,
        userAgent: typeof agente === 'string' ? agente.slice(0, LIMITE_USER_AGENT) : null,
      },
    );
    req.log.info({ formLinkId: linkId, respostaId }, 'Formulário respondido');
    return sendSuccess(reply, { enviado: true }, HTTP_STATUS.CREATED);
  });
}
