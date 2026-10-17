import { beforeEach, describe, expect, it, vi } from 'vitest';
import { salvarOverride } from '../adapters/crm-layout.repository.js';
import { CAMADA, CAMPOS_SISTEMA, LIMITES_LAYOUT, NOME_SECAO_OUTROS, NOME_SECAO_UNICA } from '../constants.js';
import { listarConfiguracaoCampos } from './configuracoes-campos.service.js';
import { emTodosOsContextos, montarCampos } from './field-schema.service.js';
import {
  layoutInicial,
  mesclarLayout,
  resolverLayout,
  salvarMeu,
  validarLayout,
} from './layout.service.js';

vi.mock('../adapters/crm-layout.repository.js', () => ({
  buscarLayoutPadrao: vi.fn().mockResolvedValue(undefined),
  buscarOverride: vi.fn().mockResolvedValue(undefined),
  salvarLayoutPadrao: vi.fn(),
  salvarOverride: vi.fn(),
  excluirOverride: vi.fn(),
}));
vi.mock('./configuracoes-campos.service.js', () => ({ listarConfiguracaoCampos: vi.fn() }));
vi.mock('./field-schema.service.js', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, obterSchemaCampos: vi.fn(async () => ({ campos: [] })) };
});

const ID = (systemKey) => `id-${systemKey}`;
const ID_SEGMENTO = 'id-segmento';
const ID_NOTA = 'id-nota';
const ORDEM_CNPJ = 10;
const ORDEM_EMPRESA = 11;
const ORDEM_SEGMENTO = 30;

/** Campos da Configurações (todo campo ativo, mesmo oculto) — o catálogo da validação. */
const CAMPOS_CONFIG = [
  ...CAMPOS_SISTEMA.map((campo) => ({
    id: ID(campo.systemKey),
    systemKey: campo.systemKey,
    tipo: campo.tipo,
    camada: campo.camada,
  })),
  { id: ID_SEGMENTO, systemKey: null, tipo: 'texto', camada: CAMADA.CAMADA_3 },
  { id: ID_NOTA, systemKey: null, tipo: 'numero', camada: CAMADA.CAMADA_3 },
];

/** Catálogo como o service monta (`catalogoDe`). */
const REFS = new Map([
  ...CAMPOS_CONFIG.map((campo) => [campo.id, campo]),
  ['lead.valor', null],
  ['lead.responsavel', null],
]);

/**
 * Schema resolvido com ids: CNPJ ligado (fora da tabela), Empresa ligada,
 * um personalizado de texto.
 */
function campos({ cnpjNaFicha = true } = {}) {
  const visibilidade = [
    { coluna: 'cnpj', visivel: true, ordem: ORDEM_CNPJ, obrigatorio: false },
    { coluna: 'empresa', visivel: true, ordem: ORDEM_EMPRESA, obrigatorio: false },
  ];
  const sobreposicoes = Object.fromEntries(
    CAMPOS_SISTEMA.map((campo) => [campo.systemKey, { id: ID(campo.systemKey), visibilidade: emTodosOsContextos(true) }]),
  );
  sobreposicoes.cnpj.visibilidade = { ...emTodosOsContextos(true), table: false, detail: cnpjNaFicha };
  const segmento = { id: ID_SEGMENTO, chave: 'segmento', label: 'Segmento', tipo: 'texto', opcoes: null, obrigatorio: false, ordem: ORDEM_SEGMENTO };
  return montarCampos(visibilidade, [segmento], sobreposicoes);
}

const refs = (itens) => itens.map((item) => item.ref);

beforeEach(() => {
  vi.clearAllMocks();
  listarConfiguracaoCampos.mockResolvedValue(CAMPOS_CONFIG);
});

describe('layoutInicial', () => {
  it('troca systemKey pelo id do campo no tenant e mantém as referências fixas', () => {
    const inicial = layoutInicial(CAMPOS_CONFIG);
    expect(inicial.identificador).toBe(ID('nome'));
    expect(inicial.destaques).toEqual(['lead.valor', ID('status'), 'lead.responsavel']);
    expect(inicial.secoes).toEqual([]);
  });
});

describe('mesclarLayout (padrão + override)', () => {
  const padrao = {
    identificador: ID('nome'),
    subtitulo: [ID('email')],
    destaques: ['lead.valor', ID('status')],
    secoes: [],
    colunas: [ID('telefone'), ID('status')],
  };

  it('sem override, é o padrão', () => {
    expect(mesclarLayout(padrao, undefined)).toBe(padrao);
  });

  it('override parcial: o que não veio segue o padrão', () => {
    const mesclado = mesclarLayout(padrao, { layout: { identificador: ID('cnpj') }, padraoVisto: {} });
    expect(mesclado.identificador).toBe(ID('cnpj'));
    expect(mesclado.colunas).toEqual(padrao.colunas);
  });

  it('campo que o DONO acrescentou DEPOIS do override entra no fim da lista do usuário', () => {
    const override = {
      layout: { colunas: [ID('status')] }, // o usuário tirou "telefone"
      padraoVisto: { colunas: [ID('telefone'), ID('status')] },
    };
    const padraoDepois = { ...padrao, colunas: [ID('telefone'), ID('status'), ID('empresa')] };

    // "telefone" ele já tinha visto e tirado: não volta. "empresa" é novo: entra no fim.
    expect(mesclarLayout(padraoDepois, override).colunas).toEqual([ID('status'), ID('empresa')]);
  });

  it('a mescla respeita o limite da lista (destaques: 4)', () => {
    const override = {
      layout: { destaques: ['lead.valor', ID('status'), ID('email'), ID('cidade')] },
      padraoVisto: { destaques: padrao.destaques },
    };
    const padraoDepois = { ...padrao, destaques: [...padrao.destaques, 'lead.responsavel'] };
    expect(mesclarLayout(padraoDepois, override).destaques).toHaveLength(LIMITES_LAYOUT.DESTAQUES);
  });
});

describe('resolverLayout', () => {
  const layout = {
    identificador: ID('cnpj'),
    subtitulo: [ID('empresa'), ID('cidade')],
    destaques: ['lead.valor', ID('status')],
    secoes: [{ nome: 'Empresa', campos: [ID('empresa'), ID('cnpj')] }],
    colunas: [ID('cnpj'), ID('telefone'), 'lead.responsavel'],
  };

  it('itens prontos pra tela; o que está oculto no contexto some', () => {
    const efetivo = resolverLayout(layout, campos());
    expect(efetivo.identificador).toMatchObject({ ref: ID('cnpj'), chave: 'cnpj', coluna: 'cnpj' });
    // Cidade (Camada 2 desligada) não está no schema → sai do subtítulo.
    expect(refs(efetivo.subtitulo)).toEqual([ID('empresa')]);
    expect(efetivo.destaques[0]).toMatchObject({ ref: 'lead.valor', chave: 'valor', label: 'Valor' });
    // CNPJ é identificador (1ª coluna fixa) e está fora da tabela: não repete.
    expect(refs(efetivo.colunas)).toEqual([ID('telefone'), 'lead.responsavel']);
  });

  it('campo da ficha fora de qualquer seção vai pra "Outros campos" no fim', () => {
    const efetivo = resolverLayout(layout, campos());
    const [primeira, outros] = efetivo.secoes;
    expect(primeira).toMatchObject({ nome: 'Empresa', automatica: false });
    expect(outros).toMatchObject({ nome: NOME_SECAO_OUTROS, automatica: true });
    expect(refs(outros.campos)).toEqual(expect.arrayContaining([ID('nome'), ID_SEGMENTO]));
  });

  it('sem seções configuradas: uma seção só com todos os campos da ficha', () => {
    const efetivo = resolverLayout({ ...layout, secoes: [] }, campos());
    expect(efetivo.secoes).toHaveLength(1);
    expect(efetivo.secoes[0].nome).toBe(NOME_SECAO_UNICA);
  });

  it('identificador oculto na ficha cai pro Nome', () => {
    const efetivo = resolverLayout(layout, campos({ cnpjNaFicha: false }));
    expect(efetivo.identificador.chave).toBe('nome');
  });
});

describe('validarLayout', () => {
  const valido = {
    identificador: ID('cnpj'),
    subtitulo: [ID('empresa')],
    destaques: ['lead.valor'],
    secoes: [],
    colunas: [ID('telefone')],
  };

  it('aceita o layout completo válido, e personalizado de texto como identificador', () => {
    expect(() => validarLayout(valido, REFS)).not.toThrow();
    expect(() => validarLayout({ ...valido, identificador: ID_SEGMENTO }, REFS)).not.toThrow();
  });

  it.each([
    ['telefone', ID('telefone')],
    ['personalizado numérico', ID_NOTA],
    ['referência fixa', 'lead.valor'],
  ])('identificador %s → 400', (_nome, identificador) => {
    expect(() => validarLayout({ ...valido, identificador }, REFS)).toThrow(/O identificador precisa ser/);
  });

  it('referência desconhecida, repetida ou campo em duas seções → 400', () => {
    expect(() => validarLayout({ ...valido, colunas: ['nao-existe'] }, REFS)).toThrow(/não é um campo ativo/);
    expect(() => validarLayout({ ...valido, destaques: ['lead.valor', 'lead.valor'] }, REFS)).toThrow(/uma vez/);
    expect(() =>
      validarLayout(
        { ...valido, secoes: [{ nome: 'A', campos: [ID('nome')] }, { nome: 'B', campos: [ID('nome')] }] },
        REFS,
      ),
    ).toThrow(/uma vez/);
  });

  it('padrão exige tudo; override aceita parcial', () => {
    expect(() => validarLayout({ colunas: [ID('telefone')] }, REFS)).toThrow(/completo/);
    expect(() => validarLayout({ colunas: [ID('telefone')] }, REFS, { parcial: true })).not.toThrow();
  });
});

describe('salvarMeu', () => {
  it('guarda as listas do padrão de agora como "vistas", só das partes sobrescritas', async () => {
    await salvarMeu('tenant-1', 'usuario-1', { colunas: [ID('status')], identificador: ID('empresa') });
    const [, , layout, padraoVisto] = salvarOverride.mock.calls[0];
    expect(layout).toEqual({ colunas: [ID('status')], identificador: ID('empresa') });
    expect(Object.keys(padraoVisto)).toEqual(['colunas']);
    expect(padraoVisto.colunas).toEqual(layoutInicial(CAMPOS_CONFIG).colunas);
  });
});
