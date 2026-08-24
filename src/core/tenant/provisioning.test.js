import { describe, it, expect, vi, beforeEach } from 'vitest';
import { provisionarTenant } from './provisioning.js';

const mockTx = {
  tenant: { create: vi.fn() },
  usuario: { create: vi.fn() },
  tenantModule: { createMany: vi.fn() },
};

const mockPrisma = {
  tenant: { findUnique: vi.fn() },
  $transaction: vi.fn((callback) => callback(mockTx)),
};

vi.mock('#core/db/tenantClient.js', () => ({
  getAdminClient: () => mockPrisma,
}));

const inputValido = {
  nome: 'Estúdio Teste',
  subdomain: 'estudio-teste',
  owner: { nome: 'Dona Teste', email: 'dona@teste.com', senha: 'senha1234' },
  modulosContratados: ['crm'],
};

describe('provisionarTenant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.tenant.findUnique.mockResolvedValue(null);
    mockTx.tenant.create.mockResolvedValue({ id: 'tenant-1' });
    mockTx.usuario.create.mockResolvedValue({ id: 'usuario-1' });
    mockTx.tenantModule.createMany.mockResolvedValue({ count: 1 });
  });

  it('rejeita subdomain já existente com statusCode 409, sem abrir transação', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-existente' });

    await expect(provisionarTenant(inputValido)).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining('estudio-teste'),
    });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejeita module key que não existe, com statusCode 400, sem abrir transação', async () => {
    const input = { ...inputValido, modulosContratados: ['modulo-inventado'] };

    await expect(provisionarTenant(input)).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining('modulo-inventado'),
    });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejeita module key vazio/inválido, com statusCode 400', async () => {
    const input = { ...inputValido, modulosContratados: [''] };

    await expect(provisionarTenant(input)).rejects.toMatchObject({ statusCode: 400 });
  });

  it('cria tenant + usuário DONO + módulos, e devolve os IDs', async () => {
    const resultado = await provisionarTenant(inputValido);

    expect(mockTx.tenant.create).toHaveBeenCalledWith({
      data: { nome: 'Estúdio Teste', subdomain: 'estudio-teste' },
    });

    expect(mockTx.usuario.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'tenant-1',
        nome: 'Dona Teste',
        email: 'dona@teste.com',
        role: 'DONO',
        ativo: false,
      }),
    });
    // senha nunca em texto puro
    const dadosUsuario = mockTx.usuario.create.mock.calls[0][0].data;
    expect(dadosUsuario.senhaHash).not.toBe('senha1234');
    expect(dadosUsuario).not.toHaveProperty('senha');

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
