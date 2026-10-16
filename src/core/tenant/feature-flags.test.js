import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { encerrarCache } from '#core/cache/cache.js';
import { registerErrorHandlers } from '#core/errors/error-handler.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { ERROR_CODES } from '#shared/http/error-codes.js';
import { exigirFeature, featureAtiva, invalidarFeatures, listarFeaturesAtivas } from './feature-flags.js';

const findMany = vi.fn();

vi.mock('#core/db/tenantClient.js', () => ({
  getAdminClient: vi.fn(() => ({ tenantModuleFeature: { findMany } })),
}));

const TENANT_A = '00000000-0000-0000-0000-00000000000a';
const TENANT_B = '00000000-0000-0000-0000-00000000000b';
const FLAG = 'crm.layout';

beforeEach(async () => {
  vi.unstubAllEnvs();
  vi.stubEnv('REDIS_URL', ''); // store em memória
  await encerrarCache();
  findMany.mockReset();
});

describe('listarFeaturesAtivas / featureAtiva', () => {
  it('lê as flags do tenant pelo client admin, com tenant_id explícito', async () => {
    findMany.mockResolvedValue([{ featureKey: FLAG }]);
    await expect(listarFeaturesAtivas(TENANT_A)).resolves.toEqual([FLAG]);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: TENANT_A } }));
  });

  it('usa o cache e só consulta de novo depois de invalidar', async () => {
    findMany.mockResolvedValue([]);
    await featureAtiva(TENANT_A, FLAG);
    await featureAtiva(TENANT_A, FLAG);
    expect(findMany).toHaveBeenCalledTimes(1);

    findMany.mockResolvedValue([{ featureKey: FLAG }]);
    await invalidarFeatures(TENANT_A);
    await expect(featureAtiva(TENANT_A, FLAG)).resolves.toBe(true);
  });

  it('cache e invalidação são por tenant', async () => {
    findMany.mockResolvedValue([]);
    await featureAtiva(TENANT_A, FLAG);
    await featureAtiva(TENANT_B, FLAG);

    await invalidarFeatures(TENANT_A);
    findMany.mockClear();
    await featureAtiva(TENANT_A, FLAG);
    await featureAtiva(TENANT_B, FLAG);
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('lista vazia em cache conta como "nenhuma ligada", não como miss', async () => {
    findMany.mockResolvedValue([]);
    await featureAtiva(TENANT_A, FLAG);
    await featureAtiva(TENANT_A, FLAG);
    expect(findMany).toHaveBeenCalledTimes(1);
  });
});

describe('exigirFeature numa rota', () => {
  let app;

  beforeAll(async () => {
    app = Fastify();
    registerErrorHandlers(app);
    app.decorateRequest('tenantContext', null);
    app.addHook('onRequest', async (req) => {
      req.tenantContext = { tenantId: TENANT_A, userId: 'u-1', role: 'DONO' };
    });
    app.get('/protegida', { preHandler: exigirFeature(FLAG) }, async () => ({ ok: true }));
    await app.ready();
  });

  afterAll(() => app.close());

  it('flag desligada → 403 FEATURE_NOT_ENABLED', async () => {
    findMany.mockResolvedValue([]);
    const resposta = await app.inject({ method: 'GET', url: '/protegida' });
    expect(resposta.statusCode).toBe(HTTP_STATUS.FORBIDDEN);
    expect(resposta.json().error.code).toBe(ERROR_CODES.FEATURE_NOT_ENABLED);
    expect(resposta.json().error.details).toEqual({ featureKey: FLAG });
  });

  it('flag ligada → 200', async () => {
    findMany.mockResolvedValue([{ featureKey: FLAG }]);
    const resposta = await app.inject({ method: 'GET', url: '/protegida' });
    expect(resposta.statusCode).toBe(HTTP_STATUS.OK);
  });

  it('sem tenantContext → 403', async () => {
    await expect(exigirFeature(FLAG)({ tenantContext: null })).rejects.toMatchObject({
      code: ERROR_CODES.FEATURE_NOT_ENABLED,
    });
  });
});
