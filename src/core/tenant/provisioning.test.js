import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { provisionarTenant } from './provisioning.js';

const mockTx = {
  tenant: { create: vi.fn() },
  usuario: { create: vi.fn() },
  tenantModule: { createMany: vi.fn() },
};

const mockPrisma = {
  $transaction: vi.fn((callback) => callback(mockTx)),
};

vi.mock('#core/db/tenantClient.js', () => ({
  getAdminClient: () => mockPrisma,
}));

const inputValido = {
  nome: 'Estúdio Teste',
  subdomain: 'estudio-teste',
  owner: { nome: 'Dona Teste', email: 'dona@teste.com' },
  modulosContratados: ['crm'],
};

describe('provisionarTenant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTx.tenant.create.mockResolvedValue({ id: 'tenant-1' });
    mockTx.usuario.create.mockResolvedValue({ id: 'usuario-1' });
    mockTx.tenantModule.createMany.mockResolvedValue({ count: 1 });
  });

  it('rejeita module key que não existe, com statusCode 400, sem abrir transação', async () => {
    const input = { ...inputValido, modulosContratados: ['modulo-inventado'] };

    await expect(provisionarTenant(input)).rejects.toMatchObject({
      statusCode: HTTP_STATUS.BAD_REQUEST,
      message: expect.stringContaining('modulo-inventado'),
    });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejeita module key vazio/inválido, com statusCode 400', async () => {
    const input = { ...inputValido, modulosContratados: [''] };

    await expect(provisionarTenant(input)).rejects.toMatchObject({ statusCode: HTTP_STATUS.BAD_REQUEST });
  });

  it('cria tenant + usuário DONO ativo e sem senha + módulos, e devolve os IDs', async () => {
    const resultado = await provisionarTenant(inputValido);

    expect(mockTx.tenant.create).toHaveBeenCalledWith({
      data: { nome: 'Estúdio Teste', subdomain: 'estudio-teste' },
    });

    expect(mockTx.usuario.create).toHaveBeenCalledWith({
      data: {
        tenantId: 'tenant-1',
        nome: 'Dona Teste',
        email: 'dona@teste.com',
        role: 'DONO',
        ativo: true,
      },
    });
    // sem senha nenhuma na criação — fluxo é convite por e-mail (ver login.service.js)
    const dadosUsuario = mockTx.usuario.create.mock.calls[0][0].data;
    expect(dadosUsuario).not.toHaveProperty('senha');
    expect(dadosUsuario).not.toHaveProperty('senhaHash');

    expect(mockTx.tenantModule.createMany).toHaveBeenCalledWith({
      data: [{ tenantId: 'tenant-1', moduleKey: 'crm' }],
    });

    expect(resultado).toEqual({ tenantId: 'tenant-1', usuarioId: 'usuario-1' });
  });

  it('sempre força role DONO, mesmo que role venha no input (ignorado)', async () => {
    await provisionarTenant({ ...inputValido, owner: { ...inputValido.owner, role: 'OPERADOR' } });

    const dadosUsuario = mockTx.usuario.create.mock.calls[0][0].data;
    expect(dadosUsuario.role).toBe('DONO');
  });
});
