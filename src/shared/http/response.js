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
 * @param {import('fastify').FastifyReply} reply
 * @param {number} statusCode
 * @param {string} message
 * @param {unknown} [details]
 */
export function sendError(reply, statusCode, message, details) {
  const error = details === undefined ? { message } : { message, details };
  return reply.code(statusCode).send({ statusCode, data: null, error });
}
