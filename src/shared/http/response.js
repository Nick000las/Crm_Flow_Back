import { HTTP_STATUS } from '#shared/constants/index.js';

/**
 * @template T
 * @param {import('fastify').FastifyReply} reply
 * @param {T} data
 * @param {number} [statusCode]
 */
export function sendSuccess(reply, data, statusCode = HTTP_STATUS.OK) {
  return reply.code(statusCode).send({ statusCode, data });
}

/**
 * Único serializador de erros HTTP da aplicação.
 *
 * @param {import('fastify').FastifyReply} reply
 * @param {{
 *   statusCode: number,
 *   code: string,
 *   message: string,
 *   fields?: Record<string, string[]>,
 *   details?: unknown,
 * }} input
 */
export function sendError(reply, { statusCode, code, message, fields, details }) {
  const error = { code, message };

  if (fields !== undefined) error.fields = fields;
  if (details !== undefined) error.details = details;

  return reply.code(statusCode).send({
    statusCode,
    data: null,
    error,
    requestId: reply.request.id,
  });
}
