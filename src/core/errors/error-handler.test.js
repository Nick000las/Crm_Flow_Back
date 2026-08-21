import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppError } from '#core/errors/app-error.js';
import { registerErrorHandlers } from '#core/errors/error-handler.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { ERROR_CODES } from '#shared/http/error-codes.js';

async function createTestApp() {
  const app = Fastify({ logger: false });
  registerErrorHandlers(app);

  app.post('/validation', async (request) => {
    z.object({
      email: z.string().email('Informe um e-mail válido'),
    }).parse(request.body);
    return { ok: true };
  });

  app.get('/known-error', async () => {
    throw new AppError({
      statusCode: HTTP_STATUS.TOO_MANY_REQUESTS,
      code: ERROR_CODES.AUTH_CODE_RATE_LIMITED,
      message: 'Aguarde antes de tentar novamente',
      details: { retryAfterSeconds: PASSWORD_RETRY_SECONDS },
      headers: { 'Retry-After': String(PASSWORD_RETRY_SECONDS) },
    });
  });

  app.get('/unexpected-error', async () => {
    throw new Error('segredo interno que não pode vazar');
  });

  app.get('/service-unavailable', async () => {
    throw new AppError({
      statusCode: HTTP_STATUS.SERVICE_UNAVAILABLE,
      code: ERROR_CODES.EMAIL_UNAVAILABLE,
      message: 'O envio de e-mail está temporariamente indisponível',
    });
  });

  app.get('/unique-conflict', async () => {
    const error = new Error('detalhe interno do Prisma');
    error.name = PRISMA_KNOWN_ERROR_NAME;
    error.code = PRISMA_UNIQUE_CONSTRAINT_CODE;
    throw error;
  });

  await app.ready();
  return app;
}

const PASSWORD_RETRY_SECONDS = 60;
const PRISMA_KNOWN_ERROR_NAME = 'PrismaClientKnownRequestError';
const PRISMA_UNIQUE_CONSTRAINT_CODE = 'P2002';

describe('contrato global de erros HTTP', () => {
  it('agrupa erros de validação por campo', async () => {
    const app = await createTestApp();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/validation',
        payload: { email: 'invalido' },
      });

      expect(response.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
      expect(response.json()).toEqual({
        statusCode: HTTP_STATUS.BAD_REQUEST,
        data: null,
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'Revise os campos destacados',
          fields: { email: ['Informe um e-mail válido'] },
        },
        requestId: expect.any(String),
      });
    } finally {
      await app.close();
    }
  });

  it('localiza erros do corpo inteiro sem mensagem padrão em inglês', async () => {
    const app = await createTestApp();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/validation',
        headers: { 'content-type': 'application/json' },
        payload: 'null',
      });

      expect(response.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
      expect(response.json()).toMatchObject({
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          fields: { _form: ['Corpo da requisição inválido'] },
        },
      });
    } finally {
      await app.close();
    }
  });

  it('normaliza JSON malformado', async () => {
    const app = await createTestApp();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/validation',
        headers: { 'content-type': 'application/json' },
        payload: '{',
      });

      expect(response.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
      expect(response.json()).toMatchObject({
        error: {
          code: ERROR_CODES.INVALID_JSON,
          message: 'O corpo da requisição deve conter um JSON válido',
        },
      });
    } finally {
      await app.close();
    }
  });

  it('preserva dados públicos e headers de um AppError', async () => {
    const app = await createTestApp();

    try {
      const response = await app.inject({ method: 'GET', url: '/known-error' });

      expect(response.statusCode).toBe(HTTP_STATUS.TOO_MANY_REQUESTS);
      expect(response.headers['retry-after']).toBe(String(PASSWORD_RETRY_SECONDS));
      expect(response.json()).toMatchObject({
        data: null,
        error: {
          code: ERROR_CODES.AUTH_CODE_RATE_LIMITED,
          message: 'Aguarde antes de tentar novamente',
          details: { retryAfterSeconds: PASSWORD_RETRY_SECONDS },
        },
        requestId: expect.any(String),
      });
    } finally {
      await app.close();
    }
  });

  it('não vaza a mensagem de um erro inesperado', async () => {
    const app = await createTestApp();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/unexpected-error',
      });

      expect(response.statusCode).toBe(HTTP_STATUS.INTERNAL_SERVER_ERROR);
      expect(response.body).not.toContain('segredo interno');
      expect(response.json()).toMatchObject({
        error: {
          code: ERROR_CODES.INTERNAL_ERROR,
          message: 'Erro interno do servidor',
        },
        requestId: expect.any(String),
      });
    } finally {
      await app.close();
    }
  });

  it('preserva erros operacionais seguros com status 5xx', async () => {
    const app = await createTestApp();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/service-unavailable',
      });

      expect(response.statusCode).toBe(HTTP_STATUS.SERVICE_UNAVAILABLE);
      expect(response.json()).toMatchObject({
        error: {
          code: ERROR_CODES.EMAIL_UNAVAILABLE,
          message: 'O envio de e-mail está temporariamente indisponível',
        },
        requestId: expect.any(String),
      });
    } finally {
      await app.close();
    }
  });

  it('serializa rotas inexistentes no mesmo contrato', async () => {
    const app = await createTestApp();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/inexistente?refreshToken=segredo',
      });

      expect(response.statusCode).toBe(HTTP_STATUS.NOT_FOUND);
      expect(response.json()).toMatchObject({
        data: null,
        error: {
          code: ERROR_CODES.ROUTE_NOT_FOUND,
          message: 'Rota não encontrada',
          details: { method: 'GET', path: '/inexistente' },
        },
        requestId: expect.any(String),
      });
      expect(response.body).not.toContain('segredo');
    } finally {
      await app.close();
    }
  });

  it('mapeia conflito de unicidade conhecido sem expor o Prisma', async () => {
    const app = await createTestApp();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/unique-conflict',
      });

      expect(response.statusCode).toBe(HTTP_STATUS.CONFLICT);
      expect(response.body).not.toContain('Prisma');
      expect(response.json()).toMatchObject({
        error: {
          code: ERROR_CODES.RESOURCE_CONFLICT,
          message: 'Já existe um registro com esses dados',
        },
      });
    } finally {
      await app.close();
    }
  });
});

describe('AppError', () => {
  it('rejeita status, código, detalhes e headers públicos inválidos', () => {
    const baseError = {
      statusCode: HTTP_STATUS.BAD_REQUEST,
      code: ERROR_CODES.REQUEST_ERROR,
      message: 'Erro público',
    };

    expect(() => new AppError({ ...baseError, statusCode: HTTP_STATUS.OK })).toThrow(
      TypeError,
    );
    expect(() => new AppError({ ...baseError, code: 'CODIGO_DESCONHECIDO' })).toThrow(
      TypeError,
    );
    expect(() => {
      const details = {};
      details.circular = details;
      return new AppError({ ...baseError, details });
    }).toThrow(TypeError);
    expect(
      () => new AppError({ ...baseError, headers: { Authorization: 'segredo' } }),
    ).toThrow(TypeError);
  });
});
