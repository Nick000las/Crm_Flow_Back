import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encerrarCache } from '#core/cache/cache.js';
import { buscarCamposDoTenant } from '../adapters/crm-fields.repository.js';
import { CAMADA, CAMPOS_SISTEMA, LISTA_CONTEXTOS_VISIBILIDADE } from '../constants.js';
import { reconciliarCampos } from './campos-reconcile.service.js';
import { montarCondicoes } from './lead-filter.service.js';
import {
  camposDoContexto,
  camposParaFiltro,
  customFieldsParaApi,
  customFieldsParaArmazenamento,
  invalidarSchemaCampos,
  obterSchemaCampos,
} from './field-schema.service.js';

// Listas (M3): tenant já semeado com as keys antigas.
vi.mock('../adapters/crm-options.repository.js', async () =>
  (await import('../testing/listas.fixture.js')).mockRepositorioOpcoes(),
);
// Regras (M8) e permissões (M13): o schema real lê as duas tabelas — sem mock, o teste ia ao banco.
vi.mock('../adapters/crm-field-rules.repository.js', () => ({
  buscarRegrasDoTenant: vi.fn().mockResolvedValue([]),
  semearRegrasDoSistema: vi.fn().mockResolvedValue(0),
}));
vi.mock('../adapters/crm-field-permissions.repository.js', () => ({
  listarPermissoes: vi.fn().mockResolvedValue([]),
}));
vi.mock('../adapters/crm-fields.repository.js', () => ({ buscarCamposDoTenant: vi.fn() }));
vi.mock('./campos-reconcile.service.js', () => ({ reconciliarCampos: vi.fn() }));

const TENANT = '00000000-0000-0000-0000-000000000001';
const ID_ORIGEM = '11111111-1111-1111-1111-111111111111';
const ID_PRIORIDADE = '22222222-2222-2222-2222-222222222222';
const CRIADO_EM = '2026-10-01T12:00:00.000Z';
const ORDEM_EMPRESA = 3;
const ORDEM_ORIGEM = 8;
const ORDEM_PRIORIDADE = 9;

const visivelEm = (visivel) =>
  Object.fromEntries(LISTA_CONTEXTOS_VISIBILIDADE.map((contexto) => [contexto, visivel]));

const DEFINICOES = [
  {
    id: ID_ORIGEM,
    chave: 'origem',
    label: 'Origem',
    tipo: 'texto',
    opcoes: null,
    obrigatorio: false,
    ordem: ORDEM_ORIGEM,
    created_at: CRIADO_EM,
  },
  {
    id: ID_PRIORIDADE,
    chave: 'prioridade',
    label: 'Prioridade',
    tipo: 'selecao',
    opcoes: ['alta', 'baixa'],
    obrigatorio: true,
    ordem: ORDEM_PRIORIDADE,
    created_at: CRIADO_EM,
  },
];

/** Tenant com Empresa ligada (obrigatória), o resto da Camada 2 oculto e 2 personalizados. */
function linhas() {
  const sistema = CAMPOS_SISTEMA.map((campo) => {
    const empresa = campo.systemKey === 'empresa';
    return {
      id: `sistema-${campo.systemKey}`,
      system_key: campo.systemKey,
      chave: campo.systemKey,
      label: campo.label,
      type: campo.tipo,
      options: null,
      position: empresa ? ORDEM_EMPRESA : campo.ordemPadrao,
      is_required: empresa ? true : campo.obrigatorioPadrao,
      is_active: true,
      created_at: CRIADO_EM,
      visibilidade: visivelEm(empresa || campo.camada === CAMADA.CAMADA_1),
    };
  });
  const personalizados = DEFINICOES.map((definicao) => ({
    id: definicao.id,
    system_key: null,
    chave: definicao.chave,
    label: definicao.label,
    type: definicao.tipo,
    options: definicao.opcoes,
    position: definicao.ordem,
    is_required: definicao.obrigatorio,
    is_active: true,
    created_at: CRIADO_EM,
    visibilidade: visivelEm(true),
  }));
  const excluido = { ...personalizados[0], id: 'excluido', chave: 'velho', is_active: false };
  return [...sistema, ...personalizados, excluido];
}

/** Mesmas linhas com um ajuste num campo ativo. */
function comAjuste(chave, ajuste) {
  return linhas().map((linha) =>
    (linha.system_key ?? linha.chave) === chave && linha.is_active
      ? { ...linha, ...ajuste }
      : linha,
  );
}

beforeEach(async () => {
  vi.stubEnv('REDIS_URL', '');
  vi.clearAllMocks();
  await encerrarCache();
  buscarCamposDoTenant.mockResolvedValue(linhas());
});

afterEach(async () => {
  await encerrarCache();
  vi.unstubAllEnvs();
});

describe('obterSchemaCampos', () => {
  it('monta Camada 2 (15 colunas), personalizados ativos e a lista de campos', async () => {
    const { visibilidade, definicoes, campos } = await obterSchemaCampos(TENANT);

    expect(visibilidade.find((item) => item.coluna === 'empresa')).toEqual({
      coluna: 'empresa',
      visivel: true,
      ordem: ORDEM_EMPRESA,
      obrigatorio: true,
    });
    expect(visibilidade.find((item) => item.coluna === 'cpf')).toEqual({
      coluna: 'cpf',
      visivel: false,
      ordem: CAMPOS_SISTEMA.find((campo) => campo.systemKey === 'cpf').ordemPadrao,
      obrigatorio: false,
    });
    expect(definicoes).toEqual(DEFINICOES); // o excluído (inativo) não entra
    expect(campos.map((campo) => campo.chave)).toEqual(
      expect.arrayContaining(['nome', 'empresa', 'origem']),
    );
    expect(campos.map((campo) => campo.chave)).not.toContain('cpf');
  });

  it('tenant sem os campos do sistema é semeado e relido', async () => {
    buscarCamposDoTenant.mockResolvedValueOnce([]).mockResolvedValueOnce(linhas());
    await obterSchemaCampos(TENANT);
    expect(reconciliarCampos).toHaveBeenCalledWith(TENANT);
    expect(buscarCamposDoTenant).toHaveBeenCalledTimes(['antes', 'depois de semear'].length);
  });

  it('tenant já semeado não reconcilia', async () => {
    await obterSchemaCampos(TENANT);
    expect(reconciliarCampos).not.toHaveBeenCalled();
  });
});

describe('cache', () => {
  it('lê do banco uma vez e de novo só depois de invalidar', async () => {
    await obterSchemaCampos(TENANT);
    await obterSchemaCampos(TENANT);
    expect(buscarCamposDoTenant).toHaveBeenCalledTimes(1);

    buscarCamposDoTenant.mockResolvedValue(comAjuste('origem', { label: 'Canal de origem' }));
    await invalidarSchemaCampos(TENANT);

    const { definicoes } = await obterSchemaCampos(TENANT);
    expect(definicoes.find((definicao) => definicao.chave === 'origem').label).toBe(
      'Canal de origem',
    );
  });
});

describe('visibilidade por contexto (M2)', () => {
  it('oculto só na tabela: continua no form/ficha/filtro e sai da tabela', async () => {
    buscarCamposDoTenant.mockResolvedValue(
      comAjuste('origem', { visibilidade: { ...visivelEm(true), table: false } }),
    );
    const { campos } = await obterSchemaCampos(TENANT);

    expect(camposDoContexto(campos, 'table').map((campo) => campo.chave)).not.toContain('origem');
    for (const contexto of ['create_form', 'detail', 'filter']) {
      expect(camposDoContexto(campos, contexto).map((campo) => campo.chave)).toContain('origem');
    }
  });

  it('fora dos filtros: some do construtor e o back rejeita filtrar por ele', async () => {
    buscarCamposDoTenant.mockResolvedValue(
      comAjuste('origem', { visibilidade: { ...visivelEm(true), filter: false } }),
    );
    const schema = await obterSchemaCampos(TENANT);

    expect(camposParaFiltro(schema).map((campo) => campo.chave)).not.toContain('origem');
    expect(() =>
      montarCondicoes(
        { filtros: [{ chave: 'origem', operador: 'igual', valor: 'site' }] },
        camposParaFiltro(schema),
      ),
    ).toThrow(/não é um campo ativo para filtro/);
  });

  it('oculto em todos os contextos sai da lista', async () => {
    buscarCamposDoTenant.mockResolvedValue(
      comAjuste('fonteLead', { visibilidade: visivelEm(false) }),
    );
    const { campos } = await obterSchemaCampos(TENANT);
    expect(campos.map((campo) => campo.chave)).not.toContain('fonteLead');
  });

  it('Camada 2 visível só na ficha conta como visível pro dado (não é removida da resposta)', async () => {
    buscarCamposDoTenant.mockResolvedValue(
      comAjuste('cargo', { visibilidade: { ...visivelEm(false), detail: true } }),
    );
    const { visibilidade, campos } = await obterSchemaCampos(TENANT);
    expect(visibilidade.find((item) => item.coluna === 'cargo').visivel).toBe(true);
    expect(camposDoContexto(campos, 'detail').map((campo) => campo.chave)).toContain('cargo');
  });

  it('contexto sem linha usa o padrão do contrato (Camada 1 visível, Camada 2 oculta)', async () => {
    buscarCamposDoTenant.mockResolvedValue(
      linhas().map((linha) =>
        linha.system_key === 'tags' || linha.system_key === 'cnpj'
          ? { ...linha, visibilidade: {} }
          : linha,
      ),
    );
    const { campos } = await obterSchemaCampos(TENANT);
    expect(campos.map((campo) => campo.chave)).toContain('tags');
    expect(campos.map((campo) => campo.chave)).not.toContain('cnpj');
  });

  it('renomear vale pra campo do sistema; obrigatoriedade da Camada 1 vem da configuração', async () => {
    buscarCamposDoTenant.mockResolvedValue(
      comAjuste('empresa', { label: 'Razão social' }).map((linha) =>
        linha.system_key === 'status' ? { ...linha, is_required: true } : linha,
      ),
    );
    const { campos } = await obterSchemaCampos(TENANT);
    expect(campos.find((campo) => campo.chave === 'empresa').label).toBe('Razão social');
    expect(campos.find((campo) => campo.chave === 'status').obrigatorio).toBe(true);
  });

  it('ordem configurada vale também pra Camada 1 (reordenar em Configurações)', async () => {
    const ULTIMA = 99;
    buscarCamposDoTenant.mockResolvedValue(comAjuste('nome', { position: ULTIMA }));
    const { campos } = await obterSchemaCampos(TENANT);
    expect(campos.at(-1).chave).toBe('nome');
  });

  it('tenant novo: Camada 2 ligada entra depois da Camada 1, na ordem do contrato', () => {
    const ordens = CAMPOS_SISTEMA.map((campo) => campo.ordemPadrao);
    expect(ordens).toEqual(CAMPOS_SISTEMA.map((_, indice) => indice));
  });

  it('obrigatoriedade fixa do contrato ganha da linha (nome nunca vira opcional)', async () => {
    buscarCamposDoTenant.mockResolvedValue(comAjuste('nome', { is_required: false }));
    const { campos } = await obterSchemaCampos(TENANT);
    expect(campos.find((campo) => campo.chave === 'nome').obrigatorio).toBe(true);
  });
});

describe('custom_fields por id', () => {
  it('a API manda por chave e o banco grava por id; null (limpar) também é traduzido', () => {
    expect(customFieldsParaArmazenamento(DEFINICOES, { origem: 'site', prioridade: null })).toEqual(
      {
        [ID_ORIGEM]: 'site',
        [ID_PRIORIDADE]: null,
      },
    );
    expect(customFieldsParaArmazenamento(DEFINICOES, undefined)).toBeUndefined();
  });

  it('chave sem definição ativa é descartada na gravação', () => {
    expect(customFieldsParaArmazenamento(DEFINICOES, { sumiu: 1 })).toEqual({});
  });

  it('a leitura volta por chave, só com personalizados ativos', () => {
    const armazenado = { [ID_ORIGEM]: 'site', excluido: 'orfao', origem: 'chave-antiga' };
    expect(customFieldsParaApi(DEFINICOES, armazenado)).toEqual({ origem: 'site' });
    expect(customFieldsParaApi(DEFINICOES, null)).toEqual({});
  });

  it('o filtro lê o personalizado pelo id', async () => {
    const schema = await obterSchemaCampos(TENANT);
    const prioridade = camposParaFiltro(schema).find((campo) => campo.chave === 'prioridade');
    expect(prioridade.chaveArmazenamento).toBe(ID_PRIORIDADE);
  });
});

describe('listas configuráveis (M3)', () => {
  it('campo de lista traz as keys ativas em opcoes e todas (com selo) em opcoesLista', async () => {
    const { buscarOpcoesDoTenant } = await import('../adapters/crm-options.repository.js');
    const { opcoesSemeadas } = await import('../testing/listas.fixture.js');
    buscarOpcoesDoTenant.mockResolvedValueOnce(
      opcoesSemeadas().map((opcao) =>
        opcao.kind === 'status' && opcao.key === 'negociacao' ? { ...opcao, ativo: false } : opcao,
      ),
    );
    const { campos, listas } = await obterSchemaCampos(TENANT);
    const status = campos.find((campo) => campo.chave === 'status');

    expect(status.lista).toBe('status');
    expect(status.opcoes).not.toContain('negociacao');
    expect(status.opcoesLista.find((opcao) => opcao.key === 'negociacao')).toMatchObject({
      ativo: false,
    });
    expect(listas.status).toHaveLength(status.opcoesLista.length);
  });

  it('tags aceitam valor novo (opcoes null), mas listam as conhecidas', async () => {
    const { campos } = await obterSchemaCampos(TENANT);
    const tags = campos.find((campo) => campo.chave === 'tags');
    expect(tags.opcoes).toBeNull();
    expect(tags.opcoesLista).toEqual([]);
  });

  it('tenant sem as listas é semeado antes', async () => {
    const { buscarOpcoesDoTenant, inserirOpcoes } =
      await import('../adapters/crm-options.repository.js');
    buscarOpcoesDoTenant.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await obterSchemaCampos(TENANT);
    expect(inserirOpcoes).toHaveBeenCalled();
  });
});
