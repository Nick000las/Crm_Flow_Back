import { describe, it, expect, vi, beforeEach } from 'vitest';
import { encerrarCache } from '#core/cache/cache.js';
import {
  listarDefinicoesPorTenant,
  criarNovaDefinicao,
  editarDefinicao,
  removerDefinicao,
} from './field-definitions.service.js';
import {
  buscarCamposDoTenant,
  buscarPersonalizadoAtivoPorChave as buscarDefinicaoPorChave,
  criarCampoPersonalizado as criarDefinicao,
  editarCampoPersonalizado as atualizarDefinicao,
  desativarCampoPersonalizado as removerDefinicaoRepository,
  existeValorDoCampo,
} from '../adapters/crm-fields.repository.js';
import { CAMPOS_SISTEMA } from '../constants.js';

// O resolver (field-schema.service.js) roda de verdade sobre o adapter
// mockado; cache zerado a cada teste.
// Listas (M3): tenant já semeado com as keys antigas.
vi.mock('../adapters/crm-options.repository.js', async () => (await import('../testing/listas.fixture.js')).mockRepositorioOpcoes());
// Regras (M8): tenant sem regra (a do sistema já semeada).
// M13: sem permissão configurada (o schema real lê a tabela).
vi.mock('../adapters/crm-field-permissions.repository.js', () => ({ listarPermissoes: vi.fn().mockResolvedValue([]) }));
vi.mock('../adapters/crm-field-rules.repository.js', () => ({
  buscarRegrasDoTenant: vi.fn().mockResolvedValue([{ id: 'r', system_key: 'motivo_perda_em_perdido' }]),
  semearRegrasDoSistema: vi.fn().mockResolvedValue(0),
}));
vi.mock('../adapters/crm-fields.repository.js', () => ({
  buscarCamposDoTenant: vi.fn(),
  buscarPersonalizadoAtivoPorChave: vi.fn().mockResolvedValue(undefined),
  criarCampoPersonalizado: vi.fn().mockResolvedValue({ id: 'def-1' }),
  editarCampoPersonalizado: vi.fn(),
  desativarCampoPersonalizado: vi.fn(),
  existeValorDoCampo: vi.fn().mockResolvedValue(false),
}));

/** Tenant já reconciliado: os campos do sistema existem (resolver não semeia). */
const LINHAS_SISTEMA = CAMPOS_SISTEMA.map((campo) => ({
  id: `id-${campo.systemKey}`,
  system_key: campo.systemKey,
  chave: campo.systemKey,
  label: campo.label,
  type: campo.tipo,
  options: null,
  position: campo.ordemPadrao,
  is_required: campo.obrigatorioPadrao,
  is_active: true,
  created_at: '2026-10-01T00:00:00Z',
  visibilidade: {},
}));

beforeEach(async () => {
  vi.clearAllMocks();
  await encerrarCache();
  buscarCamposDoTenant.mockResolvedValue(LINHAS_SISTEMA);
  buscarDefinicaoPorChave.mockResolvedValue(undefined);
  criarDefinicao.mockResolvedValue({ id: 'def-1' });
  existeValorDoCampo.mockResolvedValue(false);
});

const PRIMEIRA_ORDEM = 1;
const INPUT_VALIDO = { label: 'Origem', tipo: 'texto', opcoes: null, obrigatorio: false, ordem: PRIMEIRA_ORDEM };

describe('listarDefinicoesPorTenant', () => {
  it('devolve só os personalizados ativos, no formato da API', async () => {
    const personalizado = {
      ...LINHAS_SISTEMA[0],
      id: 'def-1',
      system_key: null,
      chave: 'origem',
      label: 'Origem',
      type: 'texto',
      position: PRIMEIRA_ORDEM,
      is_required: false,
    };
    buscarCamposDoTenant.mockResolvedValueOnce([
      ...LINHAS_SISTEMA,
      personalizado,
      { ...personalizado, id: 'def-velha', chave: 'velha', is_active: false },
    ]);
    await expect(listarDefinicoesPorTenant('tenant-1')).resolves.toEqual([
      expect.objectContaining({ id: 'def-1', chave: 'origem', tipo: 'texto', obrigatorio: false, ordem: PRIMEIRA_ORDEM }),
    ]);
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

  it('rejeita label cuja chave é a de um campo do sistema (ex: Empresa)', async () => {
    await expect(criarNovaDefinicao('tenant-1', { ...INPUT_VALIDO, label: 'Empresa' })).rejects.toThrow(
      'Já existe um campo com esse nome',
    );
    expect(criarDefinicao).not.toHaveBeenCalled();
  });

  it('criar invalida o schema em cache: a próxima leitura vê o campo novo', async () => {
    await listarDefinicoesPorTenant('tenant-1');
    await criarNovaDefinicao('tenant-1', INPUT_VALIDO);
    await listarDefinicoesPorTenant('tenant-1');
    // a checagem de nome lê a configuração direto (sem cache), e a leitura
    // depois de criar não vem do cache
    expect(buscarCamposDoTenant).toHaveBeenCalledTimes(['antes', 'checagem de nome', 'depois de criar'].length);
  });

  it('rejeita nome igual ao de um campo do sistema renomeado', async () => {
    buscarCamposDoTenant.mockResolvedValue(
      LINHAS_SISTEMA.map((linha) => (linha.system_key === 'empresa' ? { ...linha, label: 'Razão social' } : linha)),
    );
    await expect(criarNovaDefinicao('tenant-1', { ...INPUT_VALIDO, label: 'razão social' })).rejects.toThrow(
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
  const PERSONALIZADO = {
    ...LINHAS_SISTEMA[0],
    id: 'def-1',
    system_key: null,
    chave: 'origem',
    label: 'Origem',
    type: 'texto',
    is_required: false,
  };
  const EDICAO = { label: 'Novo', tipo: 'texto', opcoes: null, obrigatorio: false };

  beforeEach(() => {
    buscarCamposDoTenant.mockResolvedValue([...LINHAS_SISTEMA, PERSONALIZADO]);
  });

  it('lança 404 quando o campo não é um personalizado ativo do tenant', async () => {
    await expect(editarDefinicao('tenant-1', 'def-x', EDICAO)).rejects.toThrow('Definição de campo não encontrada');
    await expect(editarDefinicao('tenant-1', 'id-empresa', EDICAO)).rejects.toThrow(
      'Definição de campo não encontrada',
    );
    expect(atualizarDefinicao).not.toHaveBeenCalled();
  });

  it('retorna a definição atualizada quando encontra', async () => {
    atualizarDefinicao.mockResolvedValueOnce({ id: 'def-1', label: 'Novo' });
    await expect(editarDefinicao('tenant-1', 'def-1', EDICAO)).resolves.toEqual({ id: 'def-1', label: 'Novo' });
  });

  it('rejeita nome de outro campo (409), mas aceita manter o próprio', async () => {
    await expect(editarDefinicao('tenant-1', 'def-1', { ...EDICAO, label: 'E-mail' })).rejects.toThrow(
      'Já existe um campo com esse nome',
    );
    atualizarDefinicao.mockResolvedValueOnce({ id: 'def-1', label: 'Origem' });
    await expect(editarDefinicao('tenant-1', 'def-1', { ...EDICAO, label: 'origem' })).resolves.toBeTruthy();
  });

  it('obrigatório exige o campo no formulário de criação', async () => {
    buscarCamposDoTenant.mockResolvedValue([
      ...LINHAS_SISTEMA,
      { ...PERSONALIZADO, visibilidade: { create_form: false } },
    ]);
    await expect(editarDefinicao('tenant-1', 'def-1', { ...EDICAO, obrigatorio: true })).rejects.toThrow(
      /formulário de criação/,
    );
    expect(atualizarDefinicao).not.toHaveBeenCalled();
  });

  it('tipo não muda quando já há leads com valor; sem valor, muda', async () => {
    existeValorDoCampo.mockResolvedValueOnce(true);
    await expect(editarDefinicao('tenant-1', 'def-1', { ...EDICAO, tipo: 'numero' })).rejects.toThrow(
      /o tipo não pode mudar/,
    );
    expect(existeValorDoCampo).toHaveBeenCalledWith('tenant-1', 'def-1');

    atualizarDefinicao.mockResolvedValueOnce({ id: 'def-1', tipo: 'numero' });
    await expect(editarDefinicao('tenant-1', 'def-1', { ...EDICAO, tipo: 'numero' })).resolves.toBeTruthy();
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
