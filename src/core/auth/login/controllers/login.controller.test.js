import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '#api/app.js';
import {
  signAccessToken,
  signLoginMfaToken,
  signPasswordActivationToken,
  signRefreshToken,
} from '#core/auth/jwt.js';
import { loadEnv } from '#core/config/env.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { ERROR_CODES } from '#shared/http/error-codes.js';
import {
  activatePassword,
  authenticateWithPassword,
  disableMfa as disableMfaService,
  enableMfa as enableMfaService,
  getSessionUser,
  getUserSettings,
  getUserContext,
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
  getSessionUser: vi.fn(),
  getUserSettings: vi.fn(),
}));

const FRONTEND_ORIGIN = 'http://localhost:5173';
const ACTIVATION_COOKIE_NAME = 'activation_token';
const ACTIVATION_COOKIE_PATH = '/auth/activation';
const MFA_COOKIE_NAME = 'mfa_token';
const MFA_COOKIE_PATH = '/auth/mfa';
const PREFLIGHT_STATUS_CODE = 204;
const REFRESH_COOKIE_NAME = 'refresh_token';
const REFRESH_COOKIE_PATH = '/';
const ADMIN_REFRESH_COOKIE_NAME = 'admin_refresh_token';
const COOKIE_EXPIRADO = 'Expires=Thu, 01 Jan 1970 00:00:00 GMT';

/** `set-cookie` vira array quando a resposta grava mais de um cookie. */
function cookiesDaResposta(response) {
  return [response.headers['set-cookie'] ?? []].flat();
}

function cookieChamado(response, nome) {
  return cookiesDaResposta(response).find((cookie) => cookie.startsWith(`${nome}=`));
}

/** Sessão de tenant: refresh só no cookie httpOnly, nunca no corpo. */
function expectSessaoDeTenant(response) {
  expect(response.json().data).toEqual({ accessToken: expect.any(String) });
  const refresh = cookieChamado(response, REFRESH_COOKIE_NAME);
  expect(refresh).toBeDefined();
  expect(refresh).toContain('HttpOnly');
  expect(refresh).toContain(`Path=${REFRESH_COOKIE_PATH}`);
  expect(refresh).toContain('SameSite=Lax');
}

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
      expect(response.headers['access-control-allow-origin']).toBe(FRONTEND_ORIGIN);
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
    const activationToken = signPasswordActivationToken(app, activationContext);
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
      expectSessaoDeTenant(response);

      const cookie = cookieChamado(response, ACTIVATION_COOKIE_NAME);
      expect(cookie).toContain(`Path=${ACTIVATION_COOKIE_PATH}`);
      expect(cookie).toContain(COOKIE_EXPIRADO);
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
      expectSessaoDeTenant(response);
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
      expectSessaoDeTenant(response);

      const cookie = cookieChamado(response, MFA_COOKIE_NAME);
      expect(cookie).toContain(`Path=${MFA_COOKIE_PATH}`);
      expect(cookie).toContain(COOKIE_EXPIRADO);
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

  it('/auth/me devolve o contexto da sessão com módulos contratados e features ligadas', async () => {
    const app = await createTestApp();
    const tenantContext = { tenantId: 'tenant-id', userId: 'user-id', role: 'OPERADOR' };
    const accessToken = signAccessToken(app, tenantContext);
    const sessao = { ...tenantContext, modulosAtivos: ['crm'], featuresAtivas: ['crm.layout'] };
    vi.mocked(getSessionUser).mockResolvedValue(sessao);

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/auth/me',
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(response.statusCode).toBe(HTTP_STATUS.OK);
      expect(getSessionUser).toHaveBeenCalledWith(tenantContext);
      expect(response.json().data.user).toEqual(sessao);
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

describe('sessão persistida em cookie (refresh_token)', () => {
  it('MASTER recebe cookie próprio sem sobrescrever o tenant nem expor refresh no corpo', async () => {
    vi.mocked(authenticateWithPassword).mockResolvedValue({
      tenantId: null,
      userId: 'master-id',
      role: 'MASTER',
    });
    const app = await createTestApp();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/login/password',
        payload: { email: 'master@example.com', senha: 'senha-segura' },
      });

      expect(response.json().data).toEqual({
        accessToken: expect.any(String),
      });
      expect(cookieChamado(response, REFRESH_COOKIE_NAME)).toBeUndefined();
      expect(cookieChamado(response, ADMIN_REFRESH_COOKIE_NAME)).toContain('HttpOnly');
    } finally {
      await app.close();
    }
  });

  it('renova o access token lendo o refresh do cookie', async () => {
    const app = await createTestApp();
    vi.mocked(getUserContext).mockResolvedValue({
      tenantId: 'tenant-id',
      userId: 'user-id',
      role: 'DONO',
    });

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        headers: { cookie: `${REFRESH_COOKIE_NAME}=${signRefreshToken(app, 'user-id')}` },
      });

      expect(response.statusCode).toBe(HTTP_STATUS.OK);
      expect(response.json().data).toEqual({ accessToken: expect.any(String) });
      expect(getUserContext).toHaveBeenCalledWith({ userId: 'user-id' });
    } finally {
      await app.close();
    }
  });

  it('o refresh do corpo tem prioridade sobre o cookie (sessão master no mesmo navegador)', async () => {
    const app = await createTestApp();
    vi.mocked(getUserContext).mockResolvedValue({
      tenantId: null,
      userId: 'master-id',
      role: 'MASTER',
    });

    try {
      await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        headers: { cookie: `${REFRESH_COOKIE_NAME}=${signRefreshToken(app, 'tenant-user-id')}` },
        payload: { refreshToken: signRefreshToken(app, 'master-id') },
      });

      expect(getUserContext).toHaveBeenCalledWith({ userId: 'master-id' });
    } finally {
      await app.close();
    }
  });

  it('sem refresh algum responde 401', async () => {
    const app = await createTestApp();

    try {
      const response = await app.inject({ method: 'POST', url: '/auth/refresh' });

      expect(response.statusCode).toBe(HTTP_STATUS.UNAUTHORIZED);
      expect(response.json()).toMatchObject({
        error: { code: ERROR_CODES.AUTH_INVALID_REFRESH_TOKEN },
      });
    } finally {
      await app.close();
    }
  });

  it('cookie de refresh inválido responde 401 e é apagado', async () => {
    const app = await createTestApp();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        headers: { cookie: `${REFRESH_COOKIE_NAME}=adulterado` },
      });

      expect(response.statusCode).toBe(HTTP_STATUS.UNAUTHORIZED);
      expect(cookieChamado(response, REFRESH_COOKIE_NAME)).toContain(COOKIE_EXPIRADO);
    } finally {
      await app.close();
    }
  });

  it('logout de tenant apaga o cookie; logout de MASTER não mexe nele', async () => {
    const app = await createTestApp();
    const logoutComo = (role) =>
      app.inject({
        method: 'POST',
        url: '/auth/logout',
        headers: {
          authorization: `Bearer ${signAccessToken(app, { tenantId: 'tenant-id', userId: 'user-id', role })}`,
        },
      });

    try {
      const tenant = await logoutComo('DONO');
      const master = await logoutComo('MASTER');

      expect(tenant.statusCode).toBe(HTTP_STATUS.OK);
      expect(cookieChamado(tenant, REFRESH_COOKIE_NAME)).toContain(COOKIE_EXPIRADO);
      expect(master.statusCode).toBe(HTTP_STATUS.OK);
      expect(cookieChamado(master, REFRESH_COOKIE_NAME)).toBeUndefined();
      expect(cookieChamado(master, ADMIN_REFRESH_COOKIE_NAME)).toContain(COOKIE_EXPIRADO);
    } finally {
      await app.close();
    }
  });
});

describe('GET /me restaura sessões independentes', () => {
  const tenant = { tenantId: 'tenant-id', userId: 'user-id', role: 'DONO' };
  const master = { tenantId: null, userId: 'master-id', role: 'MASTER' };

  it('bootstrap sem login ou com cookie vencido é estado anônimo sem 401', async () => {
    const app = await createTestApp();
    try {
      for (const url of ['/auth/session', '/auth/session?scope=admin']) {
        const response = await app.inject({ method: 'GET', url });
        expect(response.statusCode).toBe(HTTP_STATUS.OK);
        expect(response.json().data).toEqual({ accessToken: null, user: null });
        expect(response.headers['cache-control']).toBe('no-store');
      }
      const expired = await app.inject({
        method: 'GET',
        url: '/auth/session',
        headers: { cookie: `${REFRESH_COOKIE_NAME}=invalido` },
      });
      expect(expired.statusCode).toBe(HTTP_STATUS.OK);
      expect(expired.json().data.user).toBeNull();
      expect(cookieChamado(expired, REFRESH_COOKIE_NAME)).toContain(COOKIE_EXPIRADO);
      const protectedRoute = await app.inject({ method: 'GET', url: '/admin/tenants' });
      expect(protectedRoute.statusCode).toBe(HTTP_STATUS.UNAUTHORIZED);
    } finally {
      await app.close();
    }
  });

  it('bootstrap migra cookie legado e restaura permissões sem chamar refresh', async () => {
    const app = await createTestApp();
    vi.mocked(getUserContext).mockResolvedValue(tenant);
    vi.mocked(getSessionUser).mockResolvedValue({
      ...tenant,
      modulosAtivos: ['crm'],
      featuresAtivas: [],
    });
    vi.mocked(getUserSettings).mockResolvedValue({ role: 'DONO', mfaAtivo: true });
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/auth/session',
        headers: { cookie: `${REFRESH_COOKIE_NAME}=${signRefreshToken(app, tenant.userId)}` },
      });
      expect(response.statusCode).toBe(HTTP_STATUS.OK);
      expect(response.json().data.user).toMatchObject({
        ...tenant,
        modulosAtivos: ['crm'],
        mfaAtivo: true,
      });
      expect(cookieChamado(response, REFRESH_COOKIE_NAME)).toContain('Path=/;');
      expect(
        cookiesDaResposta(response).some(
          (cookie) => cookie.includes('Path=/auth;') && cookie.includes(COOKIE_EXPIRADO),
        ),
      ).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('MASTER com tenant preserva CRM e flags no login, no F5 e na área administrativa', async () => {
    const app = await createTestApp();
    const context = { ...tenant, role: 'MASTER' };
    const permissions = {
      modulosAtivos: ['crm', 'kanban_universal'],
      featuresAtivas: ['crm.timeline', 'crm.layout', 'crm.lgpd'],
    };
    vi.mocked(authenticateWithPassword).mockResolvedValue(context);
    vi.mocked(getUserContext).mockResolvedValue(context);
    vi.mocked(getSessionUser).mockResolvedValue({ ...context, ...permissions });
    vi.mocked(getUserSettings).mockResolvedValue({
      nome: 'Master',
      role: 'MASTER',
      mfaAtivo: false,
    });
    try {
      const login = await app.inject({
        method: 'POST',
        url: '/auth/login/password',
        payload: {
          email: 'master@example.com',
          senha: 'senha-segura',
          scope: 'tenant',
        },
      });
      expect(login.statusCode).toBe(HTTP_STATUS.OK);
      const cookie = cookieChamado(login, REFRESH_COOKIE_NAME).split(';')[0];
      expect(cookieChamado(login, ADMIN_REFRESH_COOKIE_NAME)).toBeUndefined();
      for (const headers of [
        { authorization: `Bearer ${login.json().data.accessToken}` },
        { cookie },
      ]) {
        const me = await app.inject({ method: 'GET', url: '/me', headers });
        expect(me.statusCode).toBe(HTTP_STATUS.OK);
        expect(me.json().data.user).toMatchObject({ ...context, ...permissions });
      }
      const admin = await app.inject({
        method: 'GET',
        url: '/me?scope=admin',
        headers: {
          authorization: `Bearer ${login.json().data.accessToken}`,
        },
      });
      expect(admin.json().data.user).toMatchObject(permissions);
      const logout = await app.inject({
        method: 'POST',
        url: '/auth/logout',
        headers: {
          authorization: `Bearer ${login.json().data.accessToken}`,
        },
        payload: { scope: 'tenant' },
      });
      expect(cookieChamado(logout, REFRESH_COOKIE_NAME)).toContain(COOKIE_EXPIRADO);
      expect(cookieChamado(logout, ADMIN_REFRESH_COOKIE_NAME)).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('login, F5, refresh e logout mantêm o cookie da outra área', async () => {
    const app = await createTestApp();
    vi.mocked(authenticateWithPassword).mockResolvedValue(master);
    vi.mocked(getUserContext).mockResolvedValue(master);
    vi.mocked(getUserSettings).mockResolvedValue({ role: 'MASTER', mfaAtivo: true });
    try {
      const login = await app.inject({
        method: 'POST',
        url: '/auth/login/password',
        payload: {
          email: 'master@example.com',
          senha: 'senha-segura',
        },
      });
      const cookie = cookieChamado(login, ADMIN_REFRESH_COOKIE_NAME).split(';')[0];
      const headers = { cookie: `${cookie}; ${REFRESH_COOKIE_NAME}=outra-sessao` };
      const me = await app.inject({ method: 'GET', url: '/me?scope=admin', headers });
      expect(me.statusCode).toBe(HTTP_STATUS.OK);
      const refresh = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        headers,
        payload: { scope: 'admin' },
      });
      expect(refresh.statusCode).toBe(HTTP_STATUS.OK);
      expect(cookieChamado(refresh, REFRESH_COOKIE_NAME)).toBeUndefined();
      const logout = await app.inject({
        method: 'POST',
        url: '/auth/logout',
        headers: {
          ...headers,
          authorization: `Bearer ${me.json().data.accessToken}`,
        },
      });
      expect(logout.statusCode).toBe(HTTP_STATUS.OK);
      expect(cookieChamado(logout, ADMIN_REFRESH_COOKIE_NAME)).toContain(COOKIE_EXPIRADO);
      expect(cookieChamado(logout, REFRESH_COOKIE_NAME)).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('refresh migra cookie antigo para / e remove o path legado', async () => {
    const app = await createTestApp();
    vi.mocked(getUserContext).mockResolvedValue(tenant);
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        headers: {
          cookie: `${REFRESH_COOKIE_NAME}=${signRefreshToken(app, tenant.userId)}`,
        },
      });
      expect(response.statusCode).toBe(HTTP_STATUS.OK);
      expect(cookieChamado(response, REFRESH_COOKIE_NAME)).toContain('Path=/;');
      expect(
        cookiesDaResposta(response).some(
          (cookie) => cookie.includes('Path=/auth;') && cookie.includes(COOKIE_EXPIRADO),
        ),
      ).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('refresh expirado não restaura a sessão', async () => {
    const app = await createTestApp();
    const expired = app.jwt.refresh.sign(
      { userId: tenant.userId, purpose: 'refresh' },
      { expiresIn: -1 },
    );
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/me',
        headers: {
          cookie: `${REFRESH_COOKIE_NAME}=${expired}`,
        },
      });
      expect(response.statusCode).toBe(HTTP_STATUS.UNAUTHORIZED);
      expect(cookieChamado(response, REFRESH_COOKIE_NAME)).toContain(COOKIE_EXPIRADO);
    } finally {
      await app.close();
    }
  });

  it('restaura usuário, flags e MFA usando apenas o cookie após F5', async () => {
    const app = await createTestApp();
    vi.mocked(getUserContext).mockResolvedValue(tenant);
    vi.mocked(getSessionUser).mockResolvedValue({
      ...tenant,
      modulosAtivos: ['crm'],
      featuresAtivas: ['crm.layout'],
    });
    vi.mocked(getUserSettings).mockResolvedValue({ nome: 'Usuário', mfaAtivo: true, role: 'DONO' });
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/me',
        headers: {
          cookie: `${REFRESH_COOKIE_NAME}=${signRefreshToken(app, tenant.userId)}`,
        },
      });
      expect(response.statusCode).toBe(HTTP_STATUS.OK);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.json().data).toMatchObject({
        accessToken: expect.any(String),
        user: {
          ...tenant,
          nome: 'Usuário',
          mfaAtivo: true,
          modulosAtivos: ['crm'],
          featuresAtivas: ['crm.layout'],
        },
      });
      expect(response.json().data.refreshToken).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('admin usa apenas seu cookie mesmo com tenant aberto no navegador', async () => {
    const app = await createTestApp();
    vi.mocked(getUserContext).mockResolvedValue(master);
    vi.mocked(getUserSettings).mockResolvedValue({
      nome: 'Master',
      role: 'MASTER',
      mfaAtivo: false,
    });
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/me?scope=admin',
        headers: {
          cookie: `${REFRESH_COOKIE_NAME}=${signRefreshToken(app, tenant.userId)}; ${ADMIN_REFRESH_COOKIE_NAME}=${signRefreshToken(app, master.userId)}`,
        },
      });
      expect(response.statusCode).toBe(HTTP_STATUS.OK);
      expect(getUserContext).toHaveBeenLastCalledWith({ userId: master.userId });
      expect(response.json().data.user).toMatchObject(master);
      const check = await app.inject({
        method: 'GET',
        url: '/me?scope=admin',
        headers: {
          authorization: `Bearer ${response.json().data.accessToken}`,
        },
      });
      expect(check.statusCode).toBe(HTTP_STATUS.OK);
    } finally {
      await app.close();
    }
  });

  it('não restaura admin pelo cookie de tenant nem aceita cookie de escopo trocado', async () => {
    const app = await createTestApp();
    vi.mocked(getUserContext).mockResolvedValue(tenant);
    try {
      for (const cookie of [
        `${REFRESH_COOKIE_NAME}=${signRefreshToken(app, tenant.userId)}`,
        `${ADMIN_REFRESH_COOKIE_NAME}=${signRefreshToken(app, tenant.userId)}`,
      ]) {
        const response = await app.inject({
          method: 'GET',
          url: '/me?scope=admin',
          headers: { cookie },
        });
        expect(response.statusCode).toBe(HTTP_STATUS.UNAUTHORIZED);
      }
    } finally {
      await app.close();
    }
  });

  it('sem cookie não apaga o cookie legado antes de sua migração', async () => {
    const app = await createTestApp();
    try {
      const response = await app.inject({ method: 'GET', url: '/me' });
      expect(response.statusCode).toBe(HTTP_STATUS.UNAUTHORIZED);
      expect(response.headers['set-cookie']).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('cookie adulterado é apagado e usuário inativo não é restaurado', async () => {
    const app = await createTestApp();
    try {
      const invalid = await app.inject({
        method: 'GET',
        url: '/me',
        headers: { cookie: `${REFRESH_COOKIE_NAME}=adulterado` },
      });
      expect(invalid.statusCode).toBe(HTTP_STATUS.UNAUTHORIZED);
      expect(cookieChamado(invalid, REFRESH_COOKIE_NAME)).toContain(COOKIE_EXPIRADO);
      const { AppError } = await import('#core/errors/app-error.js');
      vi.mocked(getUserContext).mockRejectedValue(
        new AppError({
          statusCode: HTTP_STATUS.UNAUTHORIZED,
          code: ERROR_CODES.AUTH_INVALID_REFRESH_TOKEN,
          message: 'Inativo',
        }),
      );
      const inactive = await app.inject({
        method: 'GET',
        url: '/me',
        headers: { cookie: `${REFRESH_COOKIE_NAME}=${signRefreshToken(app, tenant.userId)}` },
      });
      expect(inactive.statusCode).toBe(HTTP_STATUS.UNAUTHORIZED);
    } finally {
      await app.close();
    }
  });
});
