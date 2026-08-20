import { ZodError } from 'zod';

/** @param {import('fastify').FastifyInstance} app */
export function registerErrorHandlers(app) {
  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send({
      error: 'Rota não encontrada',
      method: request.method,
      path: request.url,
    }),
  );

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: 'Dados inválidos',
        issues: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    const statusCode = Number(error.statusCode);
    if (statusCode >= 400 && statusCode < 500) {
      return reply.code(statusCode).send({ error: error.message });
    }

    request.log.error({ err: error }, 'Erro não tratado durante a requisição');
    return reply.code(500).send({ error: 'Erro interno do servidor' });
  });
}
