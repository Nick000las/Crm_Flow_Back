import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HTTP_STATUS } from '#shared/constants/index.js';
import {
  atualizarCampoConfigurado,
  buscarCamposDoTenant,
  reordenarCampos as reordenarCamposRepository,
} from '../adapters/crm-fields.repository.js';
import { CAMADA, CAMPOS_SISTEMA, LISTA_CONTEXTOS_VISIBILIDADE } from '../constants.js';
import { reconciliarCampos } from './campos-reconcile.service.js';
import {
  atualizarConfiguracaoCampo,
  listarConfiguracaoCampos,
  reordenarCampos,
  restaurarOrdemPadrao,
} from './configuracoes-campos.service.js';
import { invalidarSchemaCampos } from './field-schema.service.js';

// Listas (M3): tenant já semeado com as keys antigas.
vi.mock('../adapters/crm-options.repository.js', async () => (await import('../testing/listas.fixture.js')).mockRepositorioOpcoes());
vi.mock('../adapters/crm-fields.repository.js', () => ({
  buscarCamposDoTenant: vi.fn(),
  atualizarCampoConfigurado: vi.fn(),
  reordenarCampos: vi.fn(),
}));
vi.mock('./campos-reconcile.service.js', () => ({ reconciliarCampos: vi.fn() }));
vi.mock('./field-schema.service.js', async (importOriginal) => ({
  ...(await importOriginal()),
  invalidarSchemaCampos: vi.fn(),
}));

const TENANT = '00000000-0000-0000-0000-000000000001';
const ID_PERSONALIZADO = '99999999-9999-9999-9999-999999999999';
const ID_ANTIGO = '88888888-8888-8888-8888-888888888888';
const POSICAO_PERSONALIZADO = 50;

const todos = (visivel) => Object.fromEntries(LISTA_CONTEXTOS_VISIBILIDADE.map((contexto) => [contexto, visivel]));
const idDoSistema = (systemKey) => `id-${systemKey}`;

function linhas() {
  const sistema = CAMPOS_SISTEMA.map((campo, indice) => ({
    id: idDoSistema(campo.systemKey),
    system_key: campo.systemKey,
    chave: campo.systemKey,
    label: campo.label,
    type: campo.tipo,
    options: null,
    // Ordem embaralhada: o "voltar ao padrão" precisa reordenar.
    position: CAMPOS_SISTEMA.length - indice,
    is_required: campo.obrigatorioPadrao,
    is_active: true,
    created_at: '2026-10-01T00:00:00Z',
    visibilidade: todos(campo.camada === CAMADA.CAMADA_1),
  }));
  const personalizado = (id, chave, criadoEm, ativo = true) => ({
    id,
    system_key: null,
    chave,
    label: chave,
    type: 'texto',
    options: null,
    position: POSICAO_PERSONALIZADO,
    is_required: false,
    is_active: ativo,
    created_at: criadoEm,
    visibilidade: todos(true),
  });
  return [
    ...sistema,
    personalizado(ID_PERSONALIZADO, 'segmento', '2026-10-03T00:00:00Z'),
    personalizado(ID_ANTIGO, 'regiao', '2026-10-02T00:00:00Z'),
    personalizado('inativo', 'velho', '2026-09-01T00:00:00Z', false),
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  buscarCamposDoTenant.mockResolvedValue(linhas());
});

describe('listarConfiguracaoCampos', () => {
  it('lista todo campo ativo (inclusive Camada 2 oculta), com capacidades e label padrão', async () => {
    const campos = await listarConfiguracaoCampos(TENANT);

    expect(campos).toHaveLength(CAMPOS_SISTEMA.length + ['segmento', 'regiao'].length);
    expect(campos.find((campo) => campo.chave === 'nome')).toMatchObject({
      camada: CAMADA.CAMADA_1,
      labelPadrao: 'Nome',
      obrigatorio: true,
      capacidades: { canHide: false, canMakeOptional: false, canRename: true },
    });
    expect(campos.find((campo) => campo.chave === 'cpf')).toMatchObject({
      camada: CAMADA.CAMADA_2,
      visibilidade: todos(false),
    });
    expect(campos.find((campo) => campo.id === ID_PERSONALIZADO)).toMatchObject({
      camada: CAMADA.CAMADA_3,
      labelPadrao: null,
    });
  });

  it('tenant não reconciliado é reconciliado antes', async () => {
    buscarCamposDoTenant.mockResolvedValueOnce([]).mockResolvedValueOnce(linhas());
    await listarConfiguracaoCampos(TENANT);
    expect(reconciliarCampos).toHaveBeenCalledWith(TENANT);
  });
});

describe('atualizarConfiguracaoCampo — capacidades', () => {
  it('esconde um campo só da tabela e invalida o schema', async () => {
    await atualizarConfiguracaoCampo(TENANT, ID_PERSONALIZADO, { visibilidade: { table: false } });

    expect(atualizarCampoConfigurado).toHaveBeenCalledWith(TENANT, ID_PERSONALIZADO, {
      label: undefined,
      isRequired: undefined,
      visibilidade: { table: false },
    });
    expect(invalidarSchemaCampos).toHaveBeenCalledWith(TENANT);
  });

  it('campo que não pode ser ocultado → 400, sem gravar', async () => {
    await expect(
      atualizarConfiguracaoCampo(TENANT, idDoSistema('nome'), { visibilidade: { filter: false } }),
    ).rejects.toMatchObject({ fields: { visibilidade: [expect.stringContaining('não pode ser ocultado')] } });
    expect(atualizarCampoConfigurado).not.toHaveBeenCalled();
  });

  it('obrigatoriedade fixa (nome) → 400; a do status pode mudar', async () => {
    await expect(
      atualizarConfiguracaoCampo(TENANT, idDoSistema('nome'), { obrigatorio: false }),
    ).rejects.toMatchObject({ fields: { obrigatorio: expect.any(Array) } });

    await atualizarConfiguracaoCampo(TENANT, idDoSistema('status'), { obrigatorio: true });
    expect(atualizarCampoConfigurado).toHaveBeenCalledWith(TENANT, idDoSistema('status'), expect.objectContaining({
      isRequired: true,
    }));
  });

  it('obrigatório fora do formulário de criação → 400 (nas duas ordens)', async () => {
    await expect(
      atualizarConfiguracaoCampo(TENANT, ID_PERSONALIZADO, { obrigatorio: true, visibilidade: { create_form: false } }),
    ).rejects.toMatchObject({ fields: { visibilidade: [expect.stringContaining('formulário de criação')] } });

    // `nome` é obrigatório e nem pode ser ocultado — o erro de ocultar vem antes.
    await expect(
      atualizarConfiguracaoCampo(TENANT, idDoSistema('nome'), { visibilidade: { create_form: false } }),
    ).rejects.toThrow();
  });

  it('renomear campo do sistema; `null` volta ao padrão; nome repetido → 409', async () => {
    await atualizarConfiguracaoCampo(TENANT, idDoSistema('empresa'), { label: '  Razão social ' });
    expect(atualizarCampoConfigurado.mock.calls[0][2].label).toBe('Razão social');

    await atualizarConfiguracaoCampo(TENANT, idDoSistema('empresa'), { label: null });
    expect(atualizarCampoConfigurado.mock.calls[1][2].label).toBe('Empresa');

    await expect(
      atualizarConfiguracaoCampo(TENANT, idDoSistema('cargo'), { label: 'nome' }),
    ).rejects.toMatchObject({ statusCode: HTTP_STATUS.CONFLICT });
  });

  it('personalizado não tem "padrão" pra voltar', async () => {
    await expect(atualizarConfiguracaoCampo(TENANT, ID_PERSONALIZADO, { label: null })).rejects.toMatchObject({
      fields: { label: expect.any(Array) },
    });
  });

  it('campo inexistente ou inativo → 404', async () => {
    await expect(atualizarConfiguracaoCampo(TENANT, 'inativo', { label: 'x' })).rejects.toMatchObject({
      statusCode: HTTP_STATUS.NOT_FOUND,
    });
  });
});

describe('ordem', () => {
  it('reordena com a lista completa', async () => {
    const ids = (await listarConfiguracaoCampos(TENANT)).map((campo) => campo.id).reverse();
    await reordenarCampos(TENANT, ids);
    expect(reordenarCamposRepository).toHaveBeenCalledWith(TENANT, ids);
    expect(invalidarSchemaCampos).toHaveBeenCalled();
  });

  it('lista incompleta, repetida ou com id estranho → 400, sem gravar', async () => {
    const ids = (await listarConfiguracaoCampos(TENANT)).map((campo) => campo.id);
    for (const invalida of [ids.slice(1), [...ids, ids[0]], [...ids.slice(1), 'outro-tenant']]) {
      await expect(reordenarCampos(TENANT, invalida)).rejects.toMatchObject({ statusCode: HTTP_STATUS.BAD_REQUEST });
    }
    expect(reordenarCamposRepository).not.toHaveBeenCalled();
  });

  it('voltar ao padrão: sistema na ordem do contrato, personalizados por criação', async () => {
    await restaurarOrdemPadrao(TENANT);

    const [[, ids]] = reordenarCamposRepository.mock.calls;
    expect(ids).toEqual([
      ...CAMPOS_SISTEMA.map((campo) => idDoSistema(campo.systemKey)),
      ID_ANTIGO, // criado antes
      ID_PERSONALIZADO,
    ]);
  });
});
