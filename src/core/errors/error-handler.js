import { ZodError } from 'zod';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { sendError } from '#shared/http/response.js';

/** @param {import('fastify').FastifyInstance} app */
export function registerErrorHandlers(app) {
  app.setNotFoundHandler((request, reply) =>
    sendError(reply, HTTP_STATUS.NOT_FOUND, 'Rota não encontrada', {
      method: request.method,
      path: request.url,
    }),
  );

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return sendError(reply, HTTP_STATUS.BAD_REQUEST, 'Dados inválidos', {
        issues: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    const statusCode = Number(error.statusCode);
    if (
      statusCode >= HTTP_STATUS.BAD_REQUEST &&
      statusCode < HTTP_STATUS.INTERNAL_SERVER_ERROR
    ) {
      return sendError(reply, statusCode, error.message);
    }

    request.log.error({ err: error }, 'Erro não tratado durante a requisição');
    return sendError(
      reply,
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      'Erro interno do servidor',
    );
  });
}
