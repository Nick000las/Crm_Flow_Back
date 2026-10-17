import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  atualizarRegra,
  buscarRegrasDoTenant,
  excluirRegra,
  inserirRegra,
} from '../adapters/crm-field-rules.repository.js';
import { HTTP_STATUS } from '#shared/constants/index.js';
import { CAMADA } from '../constants.js';
import { criarRegra, editarRegra, removerRegra } from './regras.service.js';

vi.mock('../adapters/crm-field-rules.repository.js', () => ({
  buscarRegrasDoTenant: vi.fn(),
  inserirRegra: vi.fn(async () => ({ id: 'nova' })),
  atualizarRegra: vi.fn(),
  excluirRegra: vi.fn(),
}));

const CAMPOS = [
  { id: 'f-motivo', chave: 'motivoPerda', label: 'Motivo da perda', tipo: 'selecao', camada: CAMADA.CAMADA_2, opcoes: ['preco'] },
  { id: 'f-fonte', chave: 'fonteLead', label: 'Origem', tipo: 'selecao', camada: CAMADA.CAMADA_1, opcoes: ['evento', 'site'] },
  { id: 'f-empresa', chave: 'empresa', label: 'Empresa', tipo: 'texto', camada: CAMADA.CAMADA_2 },
];
vi.mock('./field-schema.service.js', () => ({
  invalidarSchemaCampos: vi.fn(),
  obterSchemaCampos: vi.fn(async () => ({
    campos: CAMPOS,
    listas: { status: [{ key: 'novo' }, { key: 'proposta' }] },
    regras: [{ id: 'nova' }, { id: 'r-usuario' }, { id: 'r-sistema' }],
  })),
}));

const TENANT = 'tenant-1';
const LINHA_SISTEMA = {
  id: 'r-sistema',
  field_id: 'f-motivo',
  kind: 'required_from_status',
  condition: { categorias: ['perdido'] },
  effect: { obrigatorio: true },
  position: 0,
  is_active: true,
  system_key: 'motivo_perda_em_perdido',
};
const LINHA_USUARIO = {
  ...LINHA_SISTEMA,
  id: 'r-usuario',
  kind: 'conditional',
  field_id: 'f-empresa',
  condition: { campoId: 'f-fonte', operador: 'igual', valor: 'evento' },
  effect: { obrigatorio: true, visivel: false },
  system_key: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  buscarRegrasDoTenant.mockResolvedValue([LINHA_SISTEMA, LINHA_USUARIO]);
});

describe('criarRegra', () => {
  it('por status: normaliza e o efeito é sempre obrigatório', async () => {
    await criarRegra(TENANT, { kind: 'required_from_status', campoId: 'f-empresa', condicao: { status: ['proposta', 'proposta'] } });
    expect(inserirRegra).toHaveBeenCalledWith(TENANT, {
      kind: 'required_from_status',
      campoId: 'f-empresa',
      condicao: { status: ['proposta'], categorias: [] },
      efeito: { obrigatorio: true },
      ativo: true,
    });
  });

  it.each([
    ['campo alvo inexistente', { kind: 'required_from_status', campoId: 'f-x', condicao: { categorias: ['perdido'] } }, 'campo ativo'],
    ['sem status nem categoria', { kind: 'required_from_status', campoId: 'f-empresa', condicao: {} }, 'ao menos um status'],
    ['status que não existe', { kind: 'required_from_status', campoId: 'f-empresa', condicao: { status: ['xpto'] } }, 'não é uma opção'],
    [
      'operador que não serve pro tipo',
      { kind: 'conditional', campoId: 'f-empresa', condicao: { campoId: 'f-fonte', operador: 'entre', valor: { de: 1 } }, efeito: { obrigatorio: true } },
      'Operador',
    ],
    [
      'condição sobre o próprio campo',
      { kind: 'conditional', campoId: 'f-empresa', condicao: { campoId: 'f-empresa', operador: 'vazio' }, efeito: { obrigatorio: true } },
      'outro campo',
    ],
    [
      'efeito vazio',
      { kind: 'conditional', campoId: 'f-empresa', condicao: { campoId: 'f-fonte', operador: 'vazio' }, efeito: {} },
      'obrigatório e/ou visível',
    ],
  ])('%s → 400', async (_nome, input, mensagem) => {
    await expect(criarRegra(TENANT, input)).rejects.toThrow(mensagem);
    expect(inserirRegra).not.toHaveBeenCalled();
  });
});

describe('editar e remover', () => {
  it('regra do sistema: liga/desliga sim; mudar conteúdo → 409; excluir → 409', async () => {
    await editarRegra(TENANT, 'r-sistema', { ativo: false });
    expect(atualizarRegra).toHaveBeenCalledWith(TENANT, 'r-sistema', expect.objectContaining({ ativo: false, campoId: 'f-motivo' }));

    await expect(editarRegra(TENANT, 'r-sistema', { campoId: 'f-empresa' })).rejects.toMatchObject({ statusCode: HTTP_STATUS.CONFLICT });
    await expect(removerRegra(TENANT, 'r-sistema')).rejects.toMatchObject({ statusCode: HTTP_STATUS.CONFLICT });
    expect(excluirRegra).not.toHaveBeenCalled();
  });

  it('regra do usuário: edição mescla com a atual e revalida; inexistente → 404', async () => {
    await editarRegra(TENANT, 'r-usuario', { condicao: { campoId: 'f-fonte', operador: 'e_um_dos', valor: ['evento', 'site'] } });
    expect(atualizarRegra).toHaveBeenCalledWith(
      TENANT,
      'r-usuario',
      expect.objectContaining({ campoId: 'f-empresa', efeito: { obrigatorio: true, visivel: false } }),
    );
    await expect(editarRegra(TENANT, 'r-x', { ativo: true })).rejects.toThrow('Regra não encontrada');
    await expect(removerRegra(TENANT, 'r-usuario')).resolves.toEqual({ removido: true });
  });
});
