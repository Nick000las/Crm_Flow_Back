import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  listarDefinicoesPorTenant,
  criarNovaDefinicao,
  editarDefinicao,
  reordenarDefinicoesDoTenant,
  removerDefinicao,
} from './field-definitions.service.js';
import {
  buscarDefinicoesPorTenant,
  buscarDefinicaoPorChave,
  criarDefinicao,
  atualizarDefinicao,
  reordenarDefinicoes,
  removerDefinicao as removerDefinicaoRepository,
} from '../adapters/field-definitions.repository.js';

vi.mock('../adapters/field-definitions.repository.js', () => ({
  buscarDefinicoesPorTenant: vi.fn().mockResolvedValue([]),
  buscarDefinicaoPorChave: vi.fn().mockResolvedValue(undefined),
  criarDefinicao: vi.fn().mockResolvedValue({ id: 'def-1' }),
  atualizarDefinicao: vi.fn(),
  reordenarDefinicoes: vi.fn().mockResolvedValue(undefined),
  removerDefinicao: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  buscarDefinicoesPorTenant.mockResolvedValue([]);
  buscarDefinicaoPorChave.mockResolvedValue(undefined);
  criarDefinicao.mockResolvedValue({ id: 'def-1' });
});

const PRIMEIRA_ORDEM = 1;
const SEGUNDA_ORDEM = 2;
const INPUT_VALIDO = { label: 'Origem', tipo: 'texto', opcoes: null, obrigatorio: false, ordem: PRIMEIRA_ORDEM };

describe('listarDefinicoesPorTenant', () => {
  it('repassa o resultado do adapter', async () => {
    buscarDefinicoesPorTenant.mockResolvedValueOnce([{ id: 'def-1' }]);
    await expect(listarDefinicoesPorTenant('tenant-1')).resolves.toEqual([{ id: 'def-1' }]);
  });
});

describe('criarNovaDefinicao', () => {
  it('rejeita label vazio antes de chamar o adapter', async () => {
    await expect(
      criarNovaDefinicao('tenant-1', { ...INPUT_VALIDO, label: '   ' }),
    ).rejects.toThrow('Informe o nome do campo');
    expect(criarDefinicao).not.toHaveBeenCalled();
  });

  it('rejeita tipo inválido', async () => {
    await expect(
      criarNovaDefinicao('tenant-1', { ...INPUT_VALIDO, tipo: 'tipo-inexistente' }),
    ).rejects.toThrow('Tipo de campo inválido');
  });

  it('rejeita seleção sem opções', async () => {
    await expect(
      criarNovaDefinicao('tenant-1', { ...INPUT_VALIDO, tipo: 'selecao', opcoes: [] }),
    ).rejects.toThrow('Informe as opções do campo');
  });

  it('rejeita label que gera chave já usada por outro campo', async () => {
    buscarDefinicaoPorChave.mockResolvedValueOnce({ id: 'def-existente' });
    await expect(criarNovaDefinicao('tenant-1', INPUT_VALIDO)).rejects.toThrow(
      'Já existe um campo com esse nome',
    );
    expect(criarDefinicao).not.toHaveBeenCalled();
  });

  it('cria com a chave derivada (slug) do label', async () => {
    await criarNovaDefinicao('tenant-1', { ...INPUT_VALIDO, label: 'Região de Atuação' });
    expect(criarDefinicao).toHaveBeenCalledWith(
      'tenant-1',
      expect.objectContaining({ chave: 'regiao_de_atuacao' }),
    );
  });

  it('nunca guarda opcoes pra tipo que não usa seleção', async () => {
    await criarNovaDefinicao('tenant-1', { ...INPUT_VALIDO, tipo: 'texto', opcoes: ['lixo'] });
    expect(criarDefinicao).toHaveBeenCalledWith('tenant-1', expect.objectContaining({ opcoes: null }));
  });
});

describe('editarDefinicao', () => {
  it('lança 404 quando o UPDATE não encontra a linha', async () => {
    atualizarDefinicao.mockResolvedValueOnce(undefined);
    await expect(
      editarDefinicao('tenant-1', 'def-x', { label: 'Novo', tipo: 'texto', opcoes: null, obrigatorio: false }),
    ).rejects.toThrow('Definição de campo não encontrada');
  });

  it('retorna a definição atualizada quando encontra', async () => {
    atualizarDefinicao.mockResolvedValueOnce({ id: 'def-1', label: 'Novo' });
    await expect(
      editarDefinicao('tenant-1', 'def-1', { label: 'Novo', tipo: 'texto', opcoes: null, obrigatorio: false }),
    ).resolves.toEqual({ id: 'def-1', label: 'Novo' });
  });
});

describe('reordenarDefinicoesDoTenant', () => {
  it('repassa a lista ordenada pro adapter', async () => {
    const ordenadas = [{ id: 'a', ordem: PRIMEIRA_ORDEM }, { id: 'b', ordem: SEGUNDA_ORDEM }];
    await reordenarDefinicoesDoTenant('tenant-1', ordenadas);
    expect(reordenarDefinicoes).toHaveBeenCalledWith('tenant-1', ordenadas);
  });
});

describe('removerDefinicao', () => {
  it('lança 404 quando o DELETE não encontra a linha', async () => {
    removerDefinicaoRepository.mockResolvedValueOnce(undefined);
    await expect(removerDefinicao('tenant-1', 'def-x')).rejects.toThrow('Definição de campo não encontrada');
  });

  it('confirma remoção com o aviso de dado órfão', async () => {
    removerDefinicaoRepository.mockResolvedValueOnce({ id: 'def-1' });
    const resultado = await removerDefinicao('tenant-1', 'def-1');
    expect(resultado).toMatchObject({ removido: true });
    expect(resultado.aviso).toMatch(/leads existentes/);
  });
});
