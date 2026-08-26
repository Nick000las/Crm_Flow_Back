import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '#api/app.js';
import { signPasswordActivationToken } from '#core/auth/jwt.js';
import { loadEnv } from '#core/config/env.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { ERROR_CODES } from '#shared/http/error-codes.js';
import { activatePassword, verifyActivationCode } from '../services/login.service.js';

vi.mock('../services/login.service.js', () => ({
  identifyEmail: vi.fn(),
  authenticateWithPassword: vi.fn(),
  verifyActivationCode: vi.fn(),
  activatePassword: vi.fn(),
  getUserContext: vi.fn(),
}));

const FRONTEND_ORIGIN = 'http://localhost:5173';
const ACTIVATION_COOKIE_NAME = 'activation_token';
const ACTIVATION_COOKIE_PATH = '/auth/activation';
const PREFLIGHT_STATUS_CODE = 204;

function createTestConfig() {
  return loadEnv({
    NODE_ENV: 'test',
    APP_NAME: 'crm-flow-back-test',
    HOST: '127.0.0.1',
    PORT: '3000',
    CORS_ORIGIN: FRONTEND_ORIGIN,
    JWT_SECRET: 'access-secret-with-at-least-32-characters',
    JWT_REFRESH_SECRET: 'refresh-secret-with-at-least-32-characters',
  });
}

async function createTestApp() {
  return buildApp({ config: createTestConfig(), logger: false });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('cookies do fluxo de ativação', () => {
  it('permite credenciais CORS para a origem configurada', async () => {
    const app = await createTestApp();

    try {
      const response = await app.inject({
        method: 'OPTIONS',
        url: '/auth/activation/verify',
        headers: {
          origin: FRONTEND_ORIGIN,
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'content-type',
        },
      });

      expect(response.statusCode).toBe(PREFLIGHT_STATUS_CODE);
      expect(response.headers['access-control-allow-origin']).toBe(
        FRONTEND_ORIGIN
      );
      expect(response.headers['access-control-allow-credentials']).toBe('true');
    } finally {
      await app.close();
    }
  });

  it('grava o token de ativação somente em cookie HttpOnly', async () => {
    vi.mocked(verifyActivationCode).mockResolvedValue({
      userId: 'user-id',
      activationCodeId: 'activation-code-id',
    });
    const app = await createTestApp();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/activation/verify',
        payload: {
          email: 'user@example.com',
          verificationCode: '123456',
        },
      });

      expect(response.statusCode).toBe(HTTP_STATUS.OK);
      expect(response.json()).toEqual({
        statusCode: HTTP_STATUS.OK,
        data: { nextStep: 'createPassword' },
      });

      const cookie = response.headers['set-cookie'];
      expect(cookie).toContain(`${ACTIVATION_COOKIE_NAME}=`);
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain(`Path=${ACTIVATION_COOKIE_PATH}`);
      expect(cookie).toContain('SameSite=Lax');
      expect(response.body).not.toContain('activationToken');
    } finally {
      await app.close();
    }
  });

  it('consome o cookie e o remove depois de criar a senha', async () => {
    const app = await createTestApp();
    const activationContext = {
      userId: 'user-id',
      activationCodeId: 'activation-code-id',
    };
    const tenantContext = {
      tenantId: 'tenant-id',
      userId: activationContext.userId,
      role: 'DONO',
    };
    const activationToken = signPasswordActivationToken(
      app,
      activationContext
    );
    vi.mocked(activatePassword).mockResolvedValue(tenantContext);

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/activation/password',
        headers: {
          cookie: `${ACTIVATION_COOKIE_NAME}=${activationToken}`,
        },
        payload: { senha: 'senha-segura' },
      });

      expect(response.statusCode).toBe(HTTP_STATUS.OK);
      expect(activatePassword).toHaveBeenCalledWith({
        ...activationContext,
        senha: 'senha-segura',
      });
      expect(response.json()).toMatchObject({
        statusCode: HTTP_STATUS.OK,
        data: {
          accessToken: expect.any(String),
          refreshToken: expect.any(String),
        },
      });

      const cookie = response.headers['set-cookie'];
      expect(cookie).toContain(`${ACTIVATION_COOKIE_NAME}=`);
      expect(cookie).toContain(`Path=${ACTIVATION_COOKIE_PATH}`);
      expect(cookie).toContain('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
    } finally {
      await app.close();
    }
  });

  it('rejeita a criação de senha sem o cookie de ativação', async () => {
    const app = await createTestApp();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/activation/password',
        payload: { senha: 'senha-segura' },
      });

      expect(response.statusCode).toBe(HTTP_STATUS.UNAUTHORIZED);
      expect(response.json()).toMatchObject({
        error: { code: ERROR_CODES.AUTH_INVALID_ACTIVATION_TOKEN },
      });
    } finally {
      await app.close();
    }
  });
});
