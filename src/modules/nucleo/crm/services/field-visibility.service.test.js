import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listarVisibilidadeDoTenant, atualizarVisibilidadeDoTenant } from './field-visibility.service.js';
import {
  buscarVisibilidadePorTenant,
  definirVisibilidade,
} from '../adapters/field-visibility.repository.js';
import { CAMADA_2_COLUNAS } from '../constants.js';

vi.mock('../adapters/field-visibility.repository.js', () => ({
  buscarVisibilidadePorTenant: vi.fn().mockResolvedValue([]),
  definirVisibilidade: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  vi.clearAllMocks();
  buscarVisibilidadePorTenant.mockResolvedValue([]);
});

const ORDEM_TESTE = 3;

describe('listarVisibilidadeDoTenant', () => {
  it('devolve a lista completa de colunas de Camada 2, mesmo sem nenhuma configurada', async () => {
    const resultado = await listarVisibilidadeDoTenant('tenant-1');
    expect(resultado).toHaveLength(CAMADA_2_COLUNAS.length);
    expect(resultado.every((item) => item.visivel === false)).toBe(true);
  });

  it('mescla o que já está configurado com o default das colunas restantes', async () => {
    buscarVisibilidadePorTenant.mockResolvedValueOnce([
      { coluna: 'empresa', visivel: true, ordem: ORDEM_TESTE, obrigatorio: true },
    ]);
    const resultado = await listarVisibilidadeDoTenant('tenant-1');
    const empresa = resultado.find((item) => item.coluna === 'empresa');
    expect(empresa).toMatchObject({ visivel: true, ordem: ORDEM_TESTE, obrigatorio: true });
    expect(resultado.find((item) => item.coluna === 'cargo')).toMatchObject({ visivel: false });
  });
});

describe('atualizarVisibilidadeDoTenant', () => {
  it('rejeita coluna fora da lista fechada, sem chamar o adapter', async () => {
    await expect(
      atualizarVisibilidadeDoTenant('tenant-1', [
        { coluna: 'coluna_inexistente', visivel: true, ordem: 0, obrigatorio: false },
      ]),
    ).rejects.toThrow('Coluna de campo inválida');
    expect(definirVisibilidade).not.toHaveBeenCalled();
  });

  it('repassa os itens válidos pro adapter e devolve a lista atualizada', async () => {
    await atualizarVisibilidadeDoTenant('tenant-1', [
      { coluna: 'empresa', visivel: true, ordem: 0, obrigatorio: false },
    ]);
    expect(definirVisibilidade).toHaveBeenCalledWith('tenant-1', [
      { coluna: 'empresa', visivel: true, ordem: 0, obrigatorio: false },
    ]);
  });
});
