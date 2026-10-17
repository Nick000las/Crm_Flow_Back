import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '#api/app.js';
import { signAccessToken } from '#core/auth/jwt.js';
import { loadEnv } from '#core/config/env.js';
import { listarNotificacoes, marcarComoLida, marcarTodasComoLidas } from '#core/notificacoes/notificacoes.js';
import { HTTP_STATUS } from '#shared/constants/index.js';

vi.mock('#core/db/tenantClient.js', () => ({
  getAdminClient: vi.fn(),
  getTenantClient: vi.fn(),
  disconnectDatabase: vi.fn(),
}));
vi.mock('#core/notificacoes/notificacoes.js', () => ({
  listarNotificacoes: vi.fn().mockResolvedValue({ itens: [] }),
  marcarComoLida: vi.fn().mockResolvedValue({ id: 'n' }),
  marcarTodasComoLidas: vi.fn().mockResolvedValue({ marcadas: 0 }),
}));

const TENANT = '00000000-0000-0000-0000-000000000001';
const USUARIO = '00000000-0000-0000-0000-000000000002';
const NOTIFICACAO = '00000000-0000-0000-0000-000000000003';
const PAGINA = 2;
const TAMANHO = 5;

let app;
let token;

beforeAll(async () => {
  app = await buildApp({
    config: loadEnv({
      NODE_ENV: 'test',
      CORS_ORIGIN: 'http://localhost:5173',
      JWT_SECRET: 'access-secret-with-at-least-32-characters',
      JWT_REFRESH_SECRET: 'refresh-secret-with-at-least-32-characters',
    }),
    logger: false,
  });
  token = signAccessToken(app, { tenantId: TENANT, userId: USUARIO, role: 'OPERADOR' });
});

afterAll(() => app.close());

beforeEach(() => vi.clearAllMocks());

const autorizado = () => ({ authorization: `Bearer ${token}` });

describe('/notificacoes', () => {
  it('sem token → 401', async () => {
    const resposta = await app.inject({ method: 'GET', url: '/notificacoes' });
    expect(resposta.statusCode).toBe(HTTP_STATUS.UNAUTHORIZED);
    expect(listarNotificacoes).not.toHaveBeenCalled();
  });

  it('lista as do usuário do token, com a paginação da query', async () => {
    const resposta = await app.inject({ method: 'GET', url: `/notificacoes?pagina=${PAGINA}&tamanho=${TAMANHO}`, headers: autorizado() });
    expect(resposta.statusCode).toBe(HTTP_STATUS.OK);
    expect(listarNotificacoes).toHaveBeenCalledWith(TENANT, USUARIO, { pagina: PAGINA, tamanho: TAMANHO });
  });

  it('marcar uma (id inválido → 400) e marcar todas', async () => {
    const invalido = await app.inject({ method: 'POST', url: '/notificacoes/abc/lida', headers: autorizado() });
    expect(invalido.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);

    await app.inject({ method: 'POST', url: `/notificacoes/${NOTIFICACAO}/lida`, headers: autorizado() });
    expect(marcarComoLida).toHaveBeenCalledWith(TENANT, USUARIO, NOTIFICACAO);

    const todas = await app.inject({ method: 'POST', url: '/notificacoes/lidas', headers: autorizado() });
    expect(todas.json().data).toEqual({ marcadas: 0 });
    expect(marcarTodasComoLidas).toHaveBeenCalledWith(TENANT, USUARIO);
  });
});
