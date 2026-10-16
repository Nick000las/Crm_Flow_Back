import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '#api/app.js';
import { signAccessToken } from '#core/auth/jwt.js';
import { loadEnv } from '#core/config/env.js';
import { TenantManagement } from '#core/tenant/management.js';
import { HTTP_STATUS } from '#shared/constants/index.js';

vi.mock('#core/db/tenantClient.js', () => ({
  getAdminClient: vi.fn(),
  getTenantClient: vi.fn(),
  disconnectDatabase: vi.fn(),
}));

vi.mock('#core/tenant/management.js', async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    TenantManagement: { atualizarTenant: vi.fn(), atualizarFeaturesTenant: vi.fn() },
  };
});

const TENANT = '00000000-0000-0000-0000-000000000001';

let app;
let tokenMaster;
let tokenDono;

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
  tokenMaster = signAccessToken(app, { tenantId: TENANT, userId: 'u-m', role: 'MASTER' });
  tokenDono = signAccessToken(app, { tenantId: TENANT, userId: 'u-d', role: 'DONO' });
});

afterAll(() => app.close());

beforeEach(() => vi.clearAllMocks());

const comoMaster = () => ({ authorization: `Bearer ${tokenMaster}` });

describe('feature flags no admin', () => {
  it('GET /admin/features devolve o catálogo declarado pelos módulos', async () => {
    const resposta = await app.inject({ method: 'GET', url: '/admin/features', headers: comoMaster() });
    expect(resposta.statusCode).toBe(HTTP_STATUS.OK);
    expect(resposta.json().data).toContainEqual({ moduleKey: 'crm', featureKey: 'crm.layout' });
  });

  it('só MASTER mexe em flags', async () => {
    const resposta = await app.inject({
      method: 'PUT',
      url: `/admin/tenants/${TENANT}/features`,
      headers: { authorization: `Bearer ${tokenDono}` },
      payload: { features: [] },
    });
    expect(resposta.statusCode).toBe(HTTP_STATUS.FORBIDDEN);
    expect(TenantManagement.atualizarFeaturesTenant).not.toHaveBeenCalled();
  });

  it('PUT /admin/tenants/:id/features repassa a lista e devolve as ligadas', async () => {
    TenantManagement.atualizarFeaturesTenant.mockResolvedValue(['crm.listas']);
    const resposta = await app.inject({
      method: 'PUT',
      url: `/admin/tenants/${TENANT}/features`,
      headers: comoMaster(),
      payload: { features: ['crm.listas'] },
    });
    expect(resposta.statusCode).toBe(HTTP_STATUS.OK);
    expect(resposta.json().data).toEqual({ features: ['crm.listas'] });
    expect(TenantManagement.atualizarFeaturesTenant).toHaveBeenCalledWith(TENANT, ['crm.listas']);
  });

  it('PUT sem a lista → 400', async () => {
    const resposta = await app.inject({
      method: 'PUT',
      url: `/admin/tenants/${TENANT}/features`,
      headers: comoMaster(),
      payload: {},
    });
    expect(resposta.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
  });
});

describe('fuso horário do tenant', () => {
  it('aceita nome IANA e grava a forma canônica', async () => {
    TenantManagement.atualizarTenant.mockResolvedValue({ id: TENANT });
    const resposta = await app.inject({
      method: 'PUT',
      url: `/admin/tenants/${TENANT}`,
      headers: comoMaster(),
      payload: { fusoHorario: 'america/manaus' },
    });
    expect(resposta.statusCode).toBe(HTTP_STATUS.OK);
    expect(TenantManagement.atualizarTenant).toHaveBeenCalledWith(TENANT, { fusoHorario: 'America/Manaus' });
  });

  it('rejeita fuso inexistente com erro no campo', async () => {
    const resposta = await app.inject({
      method: 'PUT',
      url: `/admin/tenants/${TENANT}`,
      headers: comoMaster(),
      payload: { fusoHorario: 'Marte/Olympus' },
    });
    expect(resposta.statusCode).toBe(HTTP_STATUS.BAD_REQUEST);
    expect(resposta.json().error.fields).toHaveProperty('fusoHorario');
    expect(TenantManagement.atualizarTenant).not.toHaveBeenCalled();
  });
});
