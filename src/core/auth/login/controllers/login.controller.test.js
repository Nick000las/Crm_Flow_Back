import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '#api/app.js';
import { signAccessToken, signLoginMfaToken, signPasswordActivationToken } from '#core/auth/jwt.js';
import { loadEnv } from '#core/config/env.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { ERROR_CODES } from '#shared/http/error-codes.js';
import {
  activatePassword,
  authenticateWithPassword,
  disableMfa as disableMfaService,
  enableMfa as enableMfaService,
  verifyActivationCode,
  verifyLoginMfaCode,
} from '../services/login.service.js';

vi.mock('../services/login.service.js', () => ({
  identifyEmail: vi.fn(),
  authenticateWithPassword: vi.fn(),
  verifyActivationCode: vi.fn(),
  verifyLoginMfaCode: vi.fn(),
  activatePassword: vi.fn(),
  enableMfa: vi.fn(),
  disableMfa: vi.fn(),
  getUserContext: vi.fn(),
}));

const FRONTEND_ORIGIN = 'http://localhost:5173';
const ACTIVATION_COOKIE_NAME = 'activation_token';
const ACTIVATION_COOKIE_PATH = '/auth/activation';
const MFA_COOKIE_NAME = 'mfa_token';
const MFA_COOKIE_PATH = '/auth/mfa';
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

describe('MFA por e-mail no login', () => {
  it('quando authenticateWithPassword indica mfaRequired, não emite tokens e seta cookie pendente', async () => {
    vi.mocked(authenticateWithPassword).mockResolvedValue({
      mfaRequired: true,
      userId: 'user-id',
      mfaCodeId: 'mfa-code-id',
    });
    const app = await createTestApp();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/login/password',
        payload: { email: 'user@example.com', senha: 'senha-segura' },
      });

      expect(response.statusCode).toBe(HTTP_STATUS.OK);
      expect(response.json()).toEqual({
        statusCode: HTTP_STATUS.OK,
        data: { nextStep: 'mfaCode' },
      });
      expect(response.body).not.toContain('accessToken');
      expect(response.body).not.toContain('refreshToken');

      const cookie = response.headers['set-cookie'];
      expect(cookie).toContain(`${MFA_COOKIE_NAME}=`);
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain(`Path=${MFA_COOKIE_PATH}`);
      expect(cookie).toContain('SameSite=Lax');
    } finally {
      await app.close();
    }
  });

  it('quando authenticateWithPassword devolve TenantContext, emite tokens de sessão normalmente', async () => {
    vi.mocked(authenticateWithPassword).mockResolvedValue({
      tenantId: 'tenant-id',
      userId: 'user-id',
      role: 'DONO',
    });
    const app = await createTestApp();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/login/password',
        payload: { email: 'user@example.com', senha: 'senha-segura' },
      });

      expect(response.statusCode).toBe(HTTP_STATUS.OK);
      expect(response.json()).toMatchObject({
        statusCode: HTTP_STATUS.OK,
        data: { accessToken: expect.any(String), refreshToken: expect.any(String) },
      });
      expect(response.headers['set-cookie']).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('verifica o código de MFA usando o cookie pendente e emite tokens finais', async () => {
    const app = await createTestApp();
    const mfaContext = { userId: 'user-id', mfaCodeId: 'mfa-code-id' };
    const tenantContext = { tenantId: 'tenant-id', userId: mfaContext.userId, role: 'DONO' };
    const mfaToken = signLoginMfaToken(app, mfaContext);
    vi.mocked(verifyLoginMfaCode).mockResolvedValue(tenantContext);

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/mfa/verify',
        headers: { cookie: `${MFA_COOKIE_NAME}=${mfaToken}` },
        payload: { verificationCode: '123456' },
      });

      expect(response.statusCode).toBe(HTTP_STATUS.OK);
      expect(verifyLoginMfaCode).toHaveBeenCalledWith({
        ...mfaContext,
        verificationCode: '123456',
      });
      expect(response.json()).toMatchObject({
        statusCode: HTTP_STATUS.OK,
        data: { accessToken: expect.any(String), refreshToken: expect.any(String) },
      });

      const cookie = response.headers['set-cookie'];
      expect(cookie).toContain(`${MFA_COOKIE_NAME}=`);
      expect(cookie).toContain(`Path=${MFA_COOKIE_PATH}`);
      expect(cookie).toContain('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
    } finally {
      await app.close();
    }
  });

  it('rejeita verificar MFA sem o cookie pendente', async () => {
    const app = await createTestApp();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/mfa/verify',
        payload: { verificationCode: '123456' },
      });

      expect(response.statusCode).toBe(HTTP_STATUS.UNAUTHORIZED);
      expect(response.json()).toMatchObject({
        error: { code: ERROR_CODES.AUTH_INVALID_MFA_TOKEN },
      });
      expect(verifyLoginMfaCode).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('rejeita verificar MFA com cookie adulterado/inválido', async () => {
    const app = await createTestApp();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/mfa/verify',
        headers: { cookie: `${MFA_COOKIE_NAME}=token-invalido` },
        payload: { verificationCode: '123456' },
      });

      expect(response.statusCode).toBe(HTTP_STATUS.UNAUTHORIZED);
      expect(response.json()).toMatchObject({
        error: { code: ERROR_CODES.AUTH_INVALID_MFA_TOKEN },
      });
    } finally {
      await app.close();
    }
  });

  it('liga MFA usando o userId da sessão autenticada, sem exigir senha', async () => {
    const app = await createTestApp();
    const tenantContext = { tenantId: 'tenant-id', userId: 'user-id', role: 'DONO' };
    const accessToken = signAccessToken(app, tenantContext);
    vi.mocked(enableMfaService).mockResolvedValue({ id: 'user-id', mfaAtivo: true });

    try {
      const response = await app.inject({
        method: 'PUT',
        url: '/auth/mfa',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(response.statusCode).toBe(HTTP_STATUS.OK);
      expect(enableMfaService).toHaveBeenCalledWith({ userId: 'user-id' });
    } finally {
      await app.close();
    }
  });

  it('rejeita ligar MFA sem autenticação', async () => {
    const app = await createTestApp();

    try {
      const response = await app.inject({ method: 'PUT', url: '/auth/mfa' });

      expect(response.statusCode).toBe(HTTP_STATUS.UNAUTHORIZED);
      expect(enableMfaService).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('desliga MFA usando o userId da sessão + senha do body', async () => {
    const app = await createTestApp();
    const tenantContext = { tenantId: 'tenant-id', userId: 'user-id', role: 'DONO' };
    const accessToken = signAccessToken(app, tenantContext);
    vi.mocked(disableMfaService).mockResolvedValue({ id: 'user-id', mfaAtivo: false });

    try {
      const response = await app.inject({
        method: 'DELETE',
        url: '/auth/mfa',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { senha: 'senha-segura' },
      });

      expect(response.statusCode).toBe(HTTP_STATUS.OK);
      expect(disableMfaService).toHaveBeenCalledWith({ userId: 'user-id', senha: 'senha-segura' });
    } finally {
      await app.close();
    }
  });

  it('rejeita desligar MFA sem senha no body', async () => {
    const app = await createTestApp();
    const tenantContext = { tenantId: 'tenant-id', userId: 'user-id', role: 'DONO' };
    const accessToken = signAccessToken(app, tenantContext);

    try {
      const response = await app.inject({
        method: 'DELETE',
        url: '/auth/mfa',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {},
      });

      expect(response.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
      expect(disableMfaService).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
