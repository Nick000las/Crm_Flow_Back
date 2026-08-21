import { ZodError } from 'zod';
import { AppError } from '#core/errors/app-error.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { ERROR_CODES } from '#shared/http/error-codes.js';
import { sendError } from '#shared/http/response.js';

const FASTIFY_INVALID_JSON_CODE = 'FST_ERR_CTP_INVALID_JSON_BODY';
const PRISMA_UNIQUE_CONSTRAINT_CODE = 'P2002';
const PRISMA_KNOWN_ERROR_NAME = 'PrismaClientKnownRequestError';

/** @param {import('fastify').FastifyInstance} app */
export function registerErrorHandlers(app) {
  app.setNotFoundHandler((request, reply) =>
    sendError(reply, {
      statusCode: HTTP_STATUS.NOT_FOUND,
      code: ERROR_CODES.ROUTE_NOT_FOUND,
      message: 'Rota não encontrada',
      details: { method: request.method, path: getRequestPath(request.url) },
    }),
  );

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return sendError(reply, {
        statusCode: HTTP_STATUS.BAD_REQUEST,
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Revise os campos destacados',
        fields: groupIssuesByField(error.issues),
      });
    }

    if (error instanceof AppError) {
      applyErrorHeaders(reply, error.headers);

      if (error.statusCode >= HTTP_STATUS.INTERNAL_SERVER_ERROR) {
        request.log.error(
          { err: error, errorCode: error.code },
          'Falha operacional durante a requisição',
        );
      }

      return sendError(reply, {
        statusCode: error.statusCode,
        code: error.code,
        message: error.message,
        fields: error.fields,
        details: error.details,
      });
    }

    if (error.code === FASTIFY_INVALID_JSON_CODE) {
      return sendError(reply, {
        statusCode: HTTP_STATUS.BAD_REQUEST,
        code: ERROR_CODES.INVALID_JSON,
        message: 'O corpo da requisição deve conter um JSON válido',
      });
    }

    if (
      error.name === PRISMA_KNOWN_ERROR_NAME &&
      error.code === PRISMA_UNIQUE_CONSTRAINT_CODE
    ) {
      return sendError(reply, {
        statusCode: HTTP_STATUS.CONFLICT,
        code: ERROR_CODES.RESOURCE_CONFLICT,
        message: 'Já existe um registro com esses dados',
      });
    }

    const statusCode = Number(error.statusCode);
    if (
      statusCode >= HTTP_STATUS.BAD_REQUEST &&
      statusCode < HTTP_STATUS.INTERNAL_SERVER_ERROR
    ) {
      return sendError(reply, {
        statusCode,
        code: ERROR_CODES.REQUEST_ERROR,
        message: 'Não foi possível processar a requisição',
      });
    }

    request.log.error({ err: error }, 'Erro não tratado durante a requisição');
    return sendError(reply, {
      statusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR,
      code: ERROR_CODES.INTERNAL_ERROR,
      message: 'Erro interno do servidor',
    });
  });
}

/** @param {import('zod').ZodIssue[]} issues */
function groupIssuesByField(issues) {
  return issues.reduce((fields, issue) => {
    const field = issue.path.join('.') || '_form';
    fields[field] ??= [];
    fields[field].push(
      field === '_form' ? 'Corpo da requisição inválido' : issue.message,
    );
    return fields;
  }, /** @type {Record<string, string[]>} */ ({}));
}

/** @param {string} url */
function getRequestPath(url) {
  return url.split('?')[0];
}

/**
 * @param {import('fastify').FastifyReply} reply
 * @param {Record<string, string> | undefined} headers
 */
function applyErrorHeaders(reply, headers) {
  if (!headers) return;

  for (const [name, value] of Object.entries(headers)) {
    reply.header(name, value);
  }
}
