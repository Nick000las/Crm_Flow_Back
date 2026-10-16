import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MODULES } from '#api/modules.js';
import { registrarModulos } from '#core/registry/modules.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { cacheGet, cacheSet, encerrarCache } from '#core/cache/cache.js';
import { reconciliarModulos } from '#core/tenant/reconcile.js';
import { TenantManagement, listarCatalogoFeatures } from './management.js';

const mockTx = {
  tenant: { findUnique: vi.fn() },
  tenantModule: { findMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn(), updateMany: vi.fn() },
  tenantModuleFeature: { deleteMany: vi.fn(), createMany: vi.fn() },
};

const mockPrisma = {
  tenant: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
  tenantModule: { updateMany: vi.fn() },
  $transaction: vi.fn((callback) => callback(mockTx)),
};

vi.mock('#core/tenant/reconcile.js', () => ({ reconciliarModulos: vi.fn().mockResolvedValue([]) }));

vi.mock('#core/db/tenantClient.js', () => ({
  getAdminClient: () => mockPrisma,
}));

const tenantId = 'tenant-1';
const TTL_SEGUNDOS = 60;


registrarModulos(MODULES);

describe('TenantManagement.listTenants', () => {
  it('devolve a lista de tenants com os módulos contratados como chaves', async () => {
    mockPrisma.tenant.findMany.mockResolvedValue([
      { id: tenantId, nome: 'Estúdio', modulosAtivos: [{ moduleKey: 'crm' }, { moduleKey: 'agendamento' }] },
    ]);

    const resultado = await TenantManagement.listTenants();

    expect(mockPrisma.tenant.findMany).toHaveBeenCalledWith({
      select: {
        id: true,
        nome: true,
        subdomain: true,
        status: true,
        createdAt: true,
        modulosAtivos: { where: { disabledAt: null }, select: { moduleKey: true } },
      },
    });
    expect(resultado).toEqual([{ id: tenantId, nome: 'Estúdio', modulosContratados: ['crm', 'agendamento'] }]);
  });
});

describe('TenantManagement.getTenantById', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejeita com 404 quando o tenant não existe', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue(null);

    await expect(TenantManagement.getTenantById(tenantId)).rejects.toMatchObject({ statusCode: HTTP_STATUS.NOT_FOUND });
  });

  it('devolve o tenant, incluindo os módulos ativos e as flags ligadas', async () => {
    const desligadoEm = new Date('2026-10-01T00:00:00Z');
    const modulosAtivos = [
      { moduleKey: 'crm', disabledAt: null },
      { moduleKey: 'agendamento', disabledAt: desligadoEm },
    ];
    mockPrisma.tenant.findUnique.mockResolvedValue({
      id: tenantId,
      fusoHorario: 'America/Sao_Paulo',
      modulosAtivos,
      featureFlags: [{ featureKey: 'crm.layout' }],
    });

    const resultado = await TenantManagement.getTenantById(tenantId);

    expect(resultado.modulosAtivos).toEqual(modulosAtivos);
    expect(resultado.modulosContratados).toEqual(['crm']);
    expect(resultado.features).toEqual(['crm.layout']);
    expect(resultado.fusoHorario).toBe('America/Sao_Paulo');
    expect(resultado).not.toHaveProperty('featureFlags');
  });

  it('seleciona os campos de identidade que o card do admin edita', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({ id: tenantId, modulosAtivos: [], featureFlags: [] });

    await TenantManagement.getTenantById(tenantId);

    expect(mockPrisma.tenant.findUnique.mock.calls[0][0].select).toMatchObject({
      dominioCustomizado: true,
      dataRegion: true,
      retencaoConversaMeses: true,
      fusoHorario: true,
    });
  });
});

describe('TenantManagement.atualizarTenant', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejeita com 404 quando o tenant não existe', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue(null);

    await expect(TenantManagement.atualizarTenant(tenantId, { nome: 'Novo' })).rejects.toMatchObject({
      statusCode: HTTP_STATUS.NOT_FOUND,
    });
    expect(mockPrisma.tenant.update).not.toHaveBeenCalled();
  });

  it('atualiza só com os campos recebidos, sem exigir módulos', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({ id: tenantId });
    mockPrisma.tenant.update.mockResolvedValue({ id: tenantId, nome: 'Novo Nome' });

    const resultado = await TenantManagement.atualizarTenant(tenantId, { nome: 'Novo Nome' });

    expect(mockPrisma.tenant.update).toHaveBeenCalledWith({
      where: { id: tenantId },
      data: { nome: 'Novo Nome' },
    });
    expect(resultado).toEqual({ id: tenantId, nome: 'Novo Nome' });
  });
});

describe('TenantManagement.atualizarStatusTenant', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejeita com 404 quando o tenant não existe', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue(null);

    await expect(TenantManagement.atualizarStatusTenant(tenantId, 'active')).rejects.toMatchObject({
      statusCode: HTTP_STATUS.NOT_FOUND,
    });
  });

  it('atualiza o status do tenant', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({ id: tenantId });
    mockPrisma.tenant.update.mockResolvedValue({ id: tenantId, status: 'active' });

    const resultado = await TenantManagement.atualizarStatusTenant(tenantId, 'active');

    expect(mockPrisma.tenant.update).toHaveBeenCalledWith({
      where: { id: tenantId },
      data: { status: 'active' },
    });
    expect(resultado.status).toBe('active');
  });
});

describe('TenantManagement.atualizarModulosTenant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTx.tenant.findUnique.mockResolvedValue({ id: tenantId });
    mockTx.tenantModule.findMany.mockResolvedValue([]);
    mockTx.tenantModule.deleteMany.mockResolvedValue({ count: 0 });
    mockTx.tenantModule.createMany.mockResolvedValue({ count: 0 });
  });

  it('rejeita module key inválido com 400, sem abrir transação', async () => {
    await expect(TenantManagement.atualizarModulosTenant(tenantId, ['modulo-inventado'])).rejects.toMatchObject({
      statusCode: HTTP_STATUS.BAD_REQUEST,
    });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejeita com 404 quando o tenant não existe (dentro da transação)', async () => {
    mockTx.tenant.findUnique.mockResolvedValue(null);

    await expect(TenantManagement.atualizarModulosTenant(tenantId, ['crm'])).rejects.toMatchObject({
      statusCode: HTTP_STATUS.NOT_FOUND,
    });
  });

  it('remove módulos que saíram da lista e adiciona os que entraram', async () => {
    mockTx.tenantModule.findMany.mockResolvedValue([{ moduleKey: 'crm' }, { moduleKey: 'agendamento' }]);
    mockTx.tenant.findUnique.mockResolvedValue({ id: tenantId, modulosAtivos: [{ moduleKey: 'kanban_universal' }] });

    const resultado = await TenantManagement.atualizarModulosTenant(tenantId, ['kanban_universal', 'agendamento']);

    // 'crm' saiu da lista -> remove. 'agendamento' já estava -> não mexe.
    expect(mockTx.tenantModule.deleteMany).toHaveBeenCalledWith({
      where: { tenantId, moduleKey: { in: ['crm'] } },
    });
    // 'kanban_universal' é novo -> adiciona.
    expect(mockTx.tenantModule.createMany).toHaveBeenCalledWith({
      data: [{ tenantId, moduleKey: 'kanban_universal' }],
    });
    expect(resultado.modulosAtivos).toEqual([{ moduleKey: 'kanban_universal' }]);
    // Só o recém-contratado é reconciliado.
    expect(reconciliarModulos).toHaveBeenCalledWith(tenantId, ['kanban_universal']);
  });

  it('reativa módulo desligado (soft-disable) em vez de criar de novo, e reconcilia', async () => {
    mockTx.tenantModule.findMany.mockResolvedValue([{ moduleKey: 'crm', disabledAt: new Date() }]);

    await TenantManagement.atualizarModulosTenant(tenantId, ['crm']);

    expect(mockTx.tenantModule.updateMany).toHaveBeenCalledWith({
      where: { tenantId, moduleKey: { in: ['crm'] } },
      data: { disabledAt: null, enabledAt: expect.any(Date) },
    });
    expect(mockTx.tenantModule.createMany).not.toHaveBeenCalled();
    expect(mockTx.tenantModule.deleteMany).not.toHaveBeenCalled();
    expect(reconciliarModulos).toHaveBeenCalledWith(tenantId, ['crm']);
  });

  it('módulo já desligado fora da lista continua desligado (histórico preservado)', async () => {
    mockTx.tenantModule.findMany.mockResolvedValue([{ moduleKey: 'crm', disabledAt: new Date() }]);

    await TenantManagement.atualizarModulosTenant(tenantId, []);

    expect(mockTx.tenantModule.deleteMany).not.toHaveBeenCalled();
    expect(mockTx.tenantModule.updateMany).not.toHaveBeenCalled();
  });

  it('não chama deleteMany/createMany quando não há mudança nenhuma', async () => {
    mockTx.tenantModule.findMany.mockResolvedValue([{ moduleKey: 'crm' }]);

    await TenantManagement.atualizarModulosTenant(tenantId, ['crm']);

    expect(mockTx.tenantModule.deleteMany).not.toHaveBeenCalled();
    expect(mockTx.tenantModule.createMany).not.toHaveBeenCalled();
    expect(reconciliarModulos).not.toHaveBeenCalled();
  });
});

describe('TenantManagement.desligarModuleTenant', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejeita com 404 quando o tenant não tem esse módulo ativo', async () => {
    mockPrisma.tenantModule.updateMany.mockResolvedValue({ count: 0 });

    await expect(TenantManagement.desligarModuleTenant(tenantId, 'crm')).rejects.toMatchObject({
      statusCode: HTTP_STATUS.NOT_FOUND,
    });
  });

  it('marca disabledAt e devolve confirmação', async () => {
    mockPrisma.tenantModule.updateMany.mockResolvedValue({ count: 1 });

    const resultado = await TenantManagement.desligarModuleTenant(tenantId, 'crm');

    expect(mockPrisma.tenantModule.updateMany).toHaveBeenCalledWith({
      where: { tenantId, moduleKey: 'crm', disabledAt: null },
      data: { disabledAt: expect.any(Date) },
    });
    expect(resultado).toEqual({ tenantId, moduleKey: 'crm', disabled: true });
  });
});

describe('TenantManagement.deleteTenant', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejeita com 404 quando o tenant não existe', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue(null);

    await expect(TenantManagement.deleteTenant(tenantId)).rejects.toMatchObject({ statusCode: HTTP_STATUS.NOT_FOUND });
    expect(mockPrisma.tenant.delete).not.toHaveBeenCalled();
  });

  it('deleta o tenant quando ele existe', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({ id: tenantId });
    mockPrisma.tenant.delete.mockResolvedValue({ id: tenantId });

    const resultado = await TenantManagement.deleteTenant(tenantId);

    expect(mockPrisma.tenant.delete).toHaveBeenCalledWith({ where: { id: tenantId } });
    expect(resultado).toEqual({ id: tenantId });
  });
});

describe('feature flags do tenant', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await encerrarCache();
    mockTx.tenant.findUnique.mockResolvedValue({ id: tenantId });
  });

  it('o catálogo vem do que cada módulo declara, com o módulo dono', () => {
    const catalogo = listarCatalogoFeatures();
    expect(catalogo).toContainEqual({ moduleKey: 'crm', featureKey: 'crm.layout' });
    expect(catalogo.every((item) => item.featureKey.startsWith(`${item.moduleKey}.`))).toBe(true);
  });

  it('rejeita flag fora do catálogo sem tocar no banco', async () => {
    await expect(
      TenantManagement.atualizarFeaturesTenant(tenantId, ['crm.layout', 'crm.nao_existe']),
    ).rejects.toMatchObject({ statusCode: HTTP_STATUS.BAD_REQUEST });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('substitui o conjunto: apaga as que saíram e cria as novas com o módulo', async () => {
    const ligadas = await TenantManagement.atualizarFeaturesTenant(tenantId, ['crm.listas', 'crm.layout']);

    expect(mockTx.tenantModuleFeature.deleteMany).toHaveBeenCalledWith({
      where: { tenantId, featureKey: { notIn: ['crm.listas', 'crm.layout'] } },
    });
    expect(mockTx.tenantModuleFeature.createMany).toHaveBeenCalledWith({
      data: [
        { tenantId, moduleKey: 'crm', featureKey: 'crm.listas' },
        { tenantId, moduleKey: 'crm', featureKey: 'crm.layout' },
      ],
      skipDuplicates: true,
    });
    expect(ligadas).toEqual(['crm.layout', 'crm.listas']);
  });

  it('lista vazia desliga tudo (kill switch)', async () => {
    await TenantManagement.atualizarFeaturesTenant(tenantId, []);
    expect(mockTx.tenantModuleFeature.deleteMany).toHaveBeenCalledWith({
      where: { tenantId, featureKey: { notIn: [] } },
    });
  });

  it('invalida o cache de flags do tenant', async () => {
    await cacheSet(`features:${tenantId}`, ['crm.listas'], TTL_SEGUNDOS);
    await TenantManagement.atualizarFeaturesTenant(tenantId, []);
    await expect(cacheGet(`features:${tenantId}`)).resolves.toBeUndefined();
  });

  it('404 quando o tenant não existe', async () => {
    mockTx.tenant.findUnique.mockResolvedValue(null);
    await expect(TenantManagement.atualizarFeaturesTenant(tenantId, [])).rejects.toMatchObject({
      statusCode: HTTP_STATUS.NOT_FOUND,
    });
  });
});
