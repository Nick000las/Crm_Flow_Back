import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { TenantManagement } from './management.js';

const mockTx = {
  tenant: { findUnique: vi.fn() },
  tenantModule: { findMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
};

const mockPrisma = {
  tenant: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
  tenantModule: { updateMany: vi.fn() },
  $transaction: vi.fn((callback) => callback(mockTx)),
};

vi.mock('#core/db/tenantClient.js', () => ({
  getAdminClient: () => mockPrisma,
}));

const tenantId = 'tenant-1';

describe('TenantManagement.listTenants', () => {
  it('devolve a lista de tenants com os campos selecionados', async () => {
    mockPrisma.tenant.findMany.mockResolvedValue([{ id: tenantId, nome: 'Estúdio' }]);

    const resultado = await TenantManagement.listTenants();

    expect(mockPrisma.tenant.findMany).toHaveBeenCalledWith({
      select: { id: true, nome: true, subdomain: true, status: true, createdAt: true },
    });
    expect(resultado).toEqual([{ id: tenantId, nome: 'Estúdio' }]);
  });
});

describe('TenantManagement.getTenantById', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejeita com 404 quando o tenant não existe', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue(null);

    await expect(TenantManagement.getTenantById(tenantId)).rejects.toMatchObject({ statusCode: HTTP_STATUS.NOT_FOUND });
  });

  it('devolve o tenant, incluindo os módulos ativos', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({ id: tenantId, modulosAtivos: [{ moduleKey: 'crm' }] });

    const resultado = await TenantManagement.getTenantById(tenantId);

    expect(resultado.modulosAtivos).toEqual([{ moduleKey: 'crm' }]);
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
  });

  it('não chama deleteMany/createMany quando não há mudança nenhuma', async () => {
    mockTx.tenantModule.findMany.mockResolvedValue([{ moduleKey: 'crm' }]);

    await TenantManagement.atualizarModulosTenant(tenantId, ['crm']);

    expect(mockTx.tenantModule.deleteMany).not.toHaveBeenCalled();
    expect(mockTx.tenantModule.createMany).not.toHaveBeenCalled();
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
